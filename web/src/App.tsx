import { Clipboard, ExternalLink, Link, LocateFixed, Navigation, Search, Share2, Target } from "lucide-react";
import maplibregl, { GeoJSONSource, Map } from "maplibre-gl";
import { FormEvent, useEffect, useRef, useState } from "react";

type CodeResult = {
  code: string;
  display_code?: string;
  admin_unit: { id: number; name: string; slug: string; area_km2?: number };
  clicked?: { lat: number; lon: number };
  center: { lat: number; lon: number };
  cell_size_m: number;
  grid_version: string;
  cell_polygon: GeoJSON.Polygon;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const emptyCollection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const HIGH_CELL_ZOOM = 18;

export default function App() {
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const initialCodeRef = useRef(codeFromUrl());
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [showNearbyCells, setShowNearbyCells] = useState(false);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: "map",
      center: [105.84, 21.03],
      zoom: 10,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");

    map.on("load", async () => {
      setMapReady(true);
      map.addSource("hanoi-boundary", { type: "geojson", data: emptyCollection });
      map.addSource("wards", { type: "geojson", data: emptyCollection });
      map.addSource("nearby-cells", { type: "geojson", data: emptyCollection });
      map.addSource("cell", { type: "geojson", data: emptyCollection });
      map.addSource("cell-label", { type: "geojson", data: emptyCollection });
      map.addLayer({
        id: "hanoi-boundary-fill",
        type: "fill",
        source: "hanoi-boundary",
        paint: { "fill-color": "#47a36f", "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: "wards-line",
        type: "line",
        source: "wards",
        paint: { "line-color": "#2770b8", "line-opacity": 0.35, "line-width": 0.8 },
      });
      map.addLayer({
        id: "hanoi-boundary-line",
        type: "line",
        source: "hanoi-boundary",
        paint: { "line-color": "#1f7a4d", "line-opacity": 0.85, "line-width": 1.8 },
      });
      map.addLayer({
        id: "cell-fill",
        type: "fill",
        source: "cell",
        paint: {
          "fill-color": "#f26b3a",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 17.5, 0, 18, 0.42, 20, 0.54],
        },
      });
      map.addLayer({
        id: "nearby-cells-fill",
        type: "fill",
        source: "nearby-cells",
        minzoom: HIGH_CELL_ZOOM,
        paint: { "fill-color": "#255f85", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "nearby-cells-line",
        type: "line",
        source: "nearby-cells",
        minzoom: HIGH_CELL_ZOOM,
        paint: { "line-color": "#255f85", "line-opacity": 0.48, "line-width": 1 },
      });
      map.addLayer({
        id: "cell-line",
        type: "line",
        source: "cell",
        paint: {
          "line-color": "#bd3d17",
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 2.5, 18, 4, 20, 5],
        },
      });
      map.addLayer({
        id: "cell-label",
        type: "symbol",
        source: "cell-label",
        minzoom: 17,
        layout: {
          "text-field": ["get", "label"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 17, 11, 20, 14],
          "text-anchor": "top",
          "text-offset": [0, 1.2],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#842315",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.4,
        },
      });

      const [boundary, wards] = await Promise.all([
        fetch(`${API_BASE}/v1/boundaries/hanoi`).then((res) => res.json()),
        fetch(`${API_BASE}/v1/boundaries/wards`).then((res) => res.json()),
      ]);
      source("hanoi-boundary")?.setData(boundary);
      source("wards")?.setData(wards);
    });

    map.on("click", async (event) => {
      await encode(event.lngLat.lat, event.lngLat.lng);
    });

    return () => map.remove();
  }, []);

  useEffect(() => {
    if (!mapReady || !initialCodeRef.current) return;
    const code = initialCodeRef.current;
    initialCodeRef.current = null;
    setQuery(code);
    void decodeCode(code, true, false);
  }, [mapReady]);

  useEffect(() => {
    updateNearbyCells();
  }, [showNearbyCells, result, mapReady]);

  const source = (id: string) => mapRef.current?.getSource(id) as GeoJSONSource | undefined;

  async function encode(lat: number, lon: number) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api<CodeResult>(`/v1/encode?lat=${lat}&lon=${lon}`);
      showResult(data, false, true);
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setLoading(false);
    }
  }

  async function decode(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    await decodeCode(normalizeCodeInput(query), true, true);
  }

  async function decodeCode(code: string, fly: boolean, updateUrl: boolean) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api<CodeResult>(`/v1/decode?code=${encodeURIComponent(code)}`);
      showResult(data, fly, updateUrl);
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setLoading(false);
    }
  }

  function showResult(data: CodeResult, fly: boolean, updateUrl: boolean) {
    setResult(data);
    setQuery(data.code);
    if (updateUrl) {
      window.history.replaceState(null, "", sharePath(data.code));
    }
    source("cell")?.setData({
      type: "Feature",
      properties: {},
      geometry: data.cell_polygon,
    });
    source("cell-label")?.setData({
      type: "Feature",
      properties: { label: shortCode(data.code) },
      geometry: { type: "Point", coordinates: [data.center.lon, data.center.lat] },
    });
    markerRef.current?.remove();
    markerRef.current = new maplibregl.Marker({ color: "#bd3d17" })
      .setLngLat([data.center.lon, data.center.lat])
      .addTo(mapRef.current!);
    updateNearbyCells(data);
    if (fly) {
      mapRef.current?.flyTo({ center: [data.center.lon, data.center.lat], zoom: 18, essential: true });
    }
  }

  function updateNearbyCells(nextResult = result) {
    source("nearby-cells")?.setData(showNearbyCells && nextResult ? nearbyCells(nextResult.cell_polygon) : emptyCollection);
  }

  async function copyCode() {
    if (!result) return;
    await copyText(result.code);
    setNotice("Copied code");
  }

  async function copyLink() {
    if (!result) return;
    await copyText(shareUrl(result.code));
    setNotice("Copied link");
  }

  async function shareResult() {
    if (!result) return;
    const url = shareUrl(result.code);
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Hanoi location code",
          text: result.display_code ?? result.code,
          url,
        });
        return;
      } catch (err) {
        if (isAbortError(err)) return;
      }
    }
    await copyText(url);
    setNotice("Copied link");
  }

  function openGoogleMaps() {
    if (!result) return;
    openExternal(googleMapsSearchUrl(result.center));
  }

  function openOpenStreetMap() {
    if (!result) return;
    openExternal(openStreetMapUrl(result.center));
  }

  async function copyCoordinates() {
    if (!result) return;
    await copyText(formatCoordinates(result.center));
    setNotice("Copied coordinates");
  }

  function directionsFromMyLocation() {
    if (!result || !supportsGeolocation()) return;
    setError(null);
    setNotice(null);
    setDirectionsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDirectionsLoading(false);
        openExternal(googleMapsDirectionsUrl(position.coords.latitude, position.coords.longitude, result.center));
      },
      (geoError) => {
        setDirectionsLoading(false);
        setError(messageFromGeolocationError(geoError));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <>
      {!mapReady && <div className="map-fallback">Loading map...</div>}
      <div id="map" />
      <form className="search" onSubmit={decode}>
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ba-vi.ao-mua.cay-da" />
        <button type="submit" disabled={loading}>Find</button>
        <div className="search-example">Example: ba-vi.ao-mua.cay-da</div>
      </form>
      <aside className="panel">
        <div className="panel-title">
          <Target size={18} />
          <span>Hanoi location code</span>
        </div>
        {notice && <div className="notice">{notice}</div>}
        {error && <div className="error">{error}</div>}
        {!result && !error && <p className="muted">Click inside Hanoi or search a code.</p>}
        {result && (
          <div className="result">
            <div>
              <label>Code</label>
              <strong>{result.code}</strong>
              {result.display_code && <small>{result.display_code}</small>}
            </div>
            <div>
              <label>Admin unit</label>
              <span>{result.admin_unit.name}</span>
            </div>
            {result.clicked && (
              <div>
                <label>Clicked</label>
                <span>{result.clicked.lat.toFixed(7)}, {result.clicked.lon.toFixed(7)}</span>
              </div>
            )}
            <div>
              <label>Center lat/lon</label>
              <span>{result.center.lat.toFixed(7)}, {result.center.lon.toFixed(7)}</span>
            </div>
            <div>
              <label>Grid</label>
              <span>{result.grid_version} · {result.cell_size_m}m</span>
            </div>
            <p className="cell-note">Each square represents approximately 3m x 3m.</p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showNearbyCells}
                onChange={(event) => setShowNearbyCells(event.target.checked)}
              />
              <span>Show nearby cells</span>
            </label>
            <div className="actions" aria-label="Location code actions">
              <button type="button" onClick={copyCode}>
                <Clipboard size={16} />
                Copy Code
              </button>
              <button type="button" onClick={copyLink}>
                <Link size={16} />
                Copy Link
              </button>
              <button type="button" onClick={shareResult}>
                <Share2 size={16} />
                Share
              </button>
              <button type="button" onClick={openGoogleMaps}>
                <ExternalLink size={16} />
                Google Maps
              </button>
              <button type="button" onClick={openOpenStreetMap}>
                <Navigation size={16} />
                OpenStreetMap
              </button>
              <button type="button" onClick={copyCoordinates}>
                <Clipboard size={16} />
                Copy Coordinates
              </button>
              {supportsGeolocation() && (
                <button type="button" onClick={directionsFromMyLocation} disabled={directionsLoading}>
                  <LocateFixed size={16} />
                  {directionsLoading ? "Locating..." : "Directions from my location"}
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(body?.detail?.code, body?.detail?.message ?? "Request failed");
  }
  return body;
}

function messageFromError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "OUT_OF_SUPPORTED_AREA" || error.code === "CELL_NOT_ASSIGNED" || error.code === "CODE_NOT_ASSIGNED") {
      return "Code is outside supported area";
    }
    if (error.code === "INVALID_CODE_FORMAT") {
      return "Invalid code. Try ba-vi.ao-mua.cay-da";
    }
    if (error.code === "UNKNOWN_ADMIN_UNIT") {
      return "Invalid code: admin unit not found";
    }
    if (error.code === "UNKNOWN_WORD") {
      return "Invalid code: word not found";
    }
  }
  return error instanceof Error ? error.message : "Request failed";
}

class ApiError extends Error {
  constructor(readonly code: string | undefined, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function codeFromUrl(): string | null {
  const pathMatch = window.location.pathname.match(/^\/c\/(.+)$/);
  if (pathMatch) return normalizeCodeInput(decodeURIComponent(pathMatch[1]));
  const code = new URLSearchParams(window.location.search).get("code");
  return code ? normalizeCodeInput(code) : null;
}

function sharePath(code: string): string {
  return `/c/${encodeURIComponent(code)}`;
}

function shareUrl(code: string): string {
  return new URL(sharePath(code), window.location.origin).toString();
}

function googleMapsSearchUrl(point: { lat: number; lon: number }): string {
  const query = `${point.lat},${point.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function googleMapsDirectionsUrl(originLat: number, originLon: number, destination: { lat: number; lon: number }): string {
  const origin = `${originLat},${originLon}`;
  const target = `${destination.lat},${destination.lon}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(target)}`;
}

function openStreetMapUrl(point: { lat: number; lon: number }): string {
  const lat = point.lat.toFixed(7);
  const lon = point.lon.toFixed(7);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`;
}

function formatCoordinates(point: { lat: number; lon: number }): string {
  return `${point.lat.toFixed(7)}, ${point.lon.toFixed(7)}`;
}

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function supportsGeolocation(): boolean {
  return "geolocation" in navigator;
}

function messageFromGeolocationError(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return "Location permission denied";
  if (error.code === error.POSITION_UNAVAILABLE) return "Location unavailable";
  if (error.code === error.TIMEOUT) return "Location request timed out";
  return "Could not get your location";
}

function shortCode(code: string): string {
  const parts = code.split(".");
  return parts.length === 3 ? `${parts[1]}.${parts[2]}` : code;
}

function nearbyCells(polygon: GeoJSON.Polygon): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const ring = polygon.coordinates[0];
  if (ring.length < 5) return emptyCollection as GeoJSON.FeatureCollection<GeoJSON.Polygon>;

  const p0 = ring[0];
  const p1 = ring[1];
  const p3 = ring[3];
  const xStep = [p1[0] - p0[0], p1[1] - p0[1]];
  const yStep = [p3[0] - p0[0], p3[1] - p0[1]];
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];

  for (let y = -1; y <= 1; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      if (x === 0 && y === 0) continue;
      const dx = xStep[0] * x + yStep[0] * y;
      const dy = xStep[1] * x + yStep[1] * y;
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [ring.map(([lon, lat]) => [lon + dx, lat + dy])],
        },
      });
    }
  }

  return { type: "FeatureCollection", features: features.slice(0, 24) };
}

function normalizeCodeInput(value: string): string {
  const stripped = stripAccents(value.trim().toLowerCase());
  return stripped
    .replace(/\s*[./|;,]+\s*/g, ".")
    .replace(/[\s_]+/g, "-")
    .replace(/-*\.-*/g, ".")
    .replace(/-+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
}

function stripAccents(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

async function copyText(text: string) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const element = document.createElement("textarea");
  element.value = text;
  element.setAttribute("readonly", "");
  element.style.position = "fixed";
  element.style.opacity = "0";
  document.body.appendChild(element);
  element.select();
  document.execCommand("copy");
  document.body.removeChild(element);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

import { Search, Target } from "lucide-react";
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

export default function App() {
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);

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
      map.addSource("cell", { type: "geojson", data: emptyCollection });
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
        paint: { "fill-color": "#f26b3a", "fill-opacity": 0.38 },
      });
      map.addLayer({
        id: "cell-line",
        type: "line",
        source: "cell",
        paint: { "line-color": "#bd3d17", "line-width": 2 },
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

  const source = (id: string) => mapRef.current?.getSource(id) as GeoJSONSource | undefined;

  async function encode(lat: number, lon: number) {
    setLoading(true);
    setError(null);
    try {
      const data = await api<CodeResult>(`/v1/encode?lat=${lat}&lon=${lon}`);
      showResult(data, data.clicked ?? data.center, false);
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setLoading(false);
    }
  }

  async function decode(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<CodeResult>(`/v1/decode?code=${encodeURIComponent(query)}`);
      showResult(data, data.center, true);
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setLoading(false);
    }
  }

  function showResult(data: CodeResult, markerPoint: { lat: number; lon: number }, fly: boolean) {
    setResult(data);
    setQuery(data.code);
    source("cell")?.setData({
      type: "Feature",
      properties: {},
      geometry: data.cell_polygon,
    });
    markerRef.current?.remove();
    markerRef.current = new maplibregl.Marker({ color: "#bd3d17" })
      .setLngLat([markerPoint.lon, markerPoint.lat])
      .addTo(mapRef.current!);
    if (fly) {
      mapRef.current?.flyTo({ center: [data.center.lon, data.center.lat], zoom: 18, essential: true });
    }
  }

  return (
    <>
      {!mapReady && <div className="map-fallback">Loading map...</div>}
      <div id="map" />
      <form className="search" onSubmit={decode}>
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ba-vi.ao-mua.cay-da" />
        <button type="submit" disabled={loading}>Find</button>
      </form>
      <aside className="panel">
        <div className="panel-title">
          <Target size={18} />
          <span>Hanoi location code</span>
        </div>
        {error && <div className="error">{error}</div>}
        {!result && !error && <p className="muted">Click inside Hanoi or search a code.</p>}
        {result && (
          <div className="result">
            <div>
              <label>Code</label>
              <strong>{result.code}</strong>
            </div>
            <div>
              <label>Ward/commune</label>
              <span>{result.admin_unit.name}</span>
            </div>
            {result.clicked && (
              <div>
                <label>Clicked</label>
                <span>{result.clicked.lat.toFixed(7)}, {result.clicked.lon.toFixed(7)}</span>
              </div>
            )}
            <div>
              <label>Cell center</label>
              <span>{result.center.lat.toFixed(7)}, {result.center.lon.toFixed(7)}</span>
            </div>
            <div>
              <label>Grid</label>
              <span>{result.grid_version} · {result.cell_size_m}m</span>
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
    throw new Error(body?.detail?.message ?? body?.detail?.code ?? "Request failed");
  }
  return body;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

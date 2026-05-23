import { Clipboard, Code2, ExternalLink, Layers, Link, LocateFixed, Navigation, Search, Share2, Target } from "lucide-react";
import maplibregl, { GeoJSONSource, Map } from "maplibre-gl";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

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

type Suggestion = {
  suggested_code: string;
  reason: string;
  confidence: "low" | "medium" | "high";
};

type SearchResult = {
  id: string;
  type: "code" | "place" | "coordinate" | "admin_unit";
  title: string;
  subtitle: string;
  lat: number | null;
  lon: number | null;
  code: string | null;
  display_code: string | null;
  admin_unit: { name: string; slug: string } | null;
  confidence: "low" | "medium" | "high";
  source: "code" | "nominatim" | "admin_units" | "coordinate";
  match_reason?: string;
};

type SearchGroup = {
  type: "codes" | "places" | "coordinates" | "admin_units";
  title: string;
  results: SearchResult[];
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const emptyCollection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const HIGH_CELL_ZOOM = 18;
const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const cartoAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export default function App() {
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const wardsRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const initialCodeRef = useRef(codeFromUrl());
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [boundariesLoading, setBoundariesLoading] = useState(true);
  const [activity, setActivity] = useState<string | null>(null);
  const [mapTheme, setMapTheme] = useState<"osm" | "light">("osm");
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
            maxzoom: 19,
            attribution: osmAttribution,
          },
          "carto-light": {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: cartoAttribution,
          },
        },
        layers: [
          { id: "basemap-osm", type: "raster", source: "osm" },
          { id: "basemap-light", type: "raster", source: "carto-light", layout: { visibility: "none" } },
        ],
      },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");

    map.on("load", async () => {
      setMapReady(true);
      map.addSource("hanoi-boundary", { type: "geojson", data: emptyCollection });
      map.addSource("wards", { type: "geojson", data: emptyCollection });
      map.addSource("selected-ward", { type: "geojson", data: emptyCollection });
      map.addSource("nearby-cells", { type: "geojson", data: emptyCollection });
      map.addSource("cell", { type: "geojson", data: emptyCollection });
      map.addSource("cell-center", { type: "geojson", data: emptyCollection });
      map.addSource("cell-label", { type: "geojson", data: emptyCollection });
      map.addLayer({
        id: "hanoi-boundary-fill",
        type: "fill",
        source: "hanoi-boundary",
        paint: { "fill-color": "#5b6b75", "fill-opacity": 0.018 },
      });
      map.addLayer({
        id: "wards-line",
        type: "line",
        source: "wards",
        paint: {
          "line-color": "#53616b",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.12, 13, 0.22, 17, 0.34],
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.4, 14, 0.7, 18, 1],
        },
      });
      map.addLayer({
        id: "selected-ward-fill",
        type: "fill",
        source: "selected-ward",
        paint: { "fill-color": "#007a5a", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "selected-ward-line",
        type: "line",
        source: "selected-ward",
        paint: {
          "line-color": "#006b55",
          "line-opacity": 0.82,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.1, 14, 1.8, 18, 2.8],
        },
      });
      map.addLayer({
        id: "hanoi-boundary-line",
        type: "line",
        source: "hanoi-boundary",
        paint: {
          "line-color": "#3f4a52",
          "line-opacity": 0.5,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 14, 1.4, 18, 2],
        },
      });
      map.addLayer({
        id: "cell-fill",
        type: "fill",
        source: "cell",
        paint: {
          "fill-color": "#ff5a1f",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.18, 18, 0.42, 20, 0.58],
        },
      });
      map.addLayer({
        id: "nearby-cells-fill",
        type: "fill",
        source: "nearby-cells",
        minzoom: HIGH_CELL_ZOOM,
        paint: { "fill-color": "#155e75", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "nearby-cells-line",
        type: "line",
        source: "nearby-cells",
        minzoom: HIGH_CELL_ZOOM,
        paint: { "line-color": "#155e75", "line-opacity": 0.62, "line-width": 1.1 },
      });
      map.addLayer({
        id: "cell-line",
        type: "line",
        source: "cell",
        paint: {
          "line-color": "#d92d00",
          "line-opacity": 1,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.8, 16, 3.5, 18, 5.5, 20, 6.5],
        },
      });
      map.addLayer({
        id: "cell-center",
        type: "circle",
        source: "cell-center",
        minzoom: 15,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 4, 18, 6, 20, 7],
          "circle-color": "#ffffff",
          "circle-stroke-color": "#d92d00",
          "circle-stroke-width": 2.2,
          "circle-opacity": 0.98,
        },
      });
      map.addLayer({
        id: "cell-label",
        type: "symbol",
        source: "cell-label",
        minzoom: 17,
        layout: {
          "text-field": ["get", "label"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 17, 11, 20, 13],
          "text-anchor": "top",
          "text-offset": [0, 1.2],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#7c2108",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.8,
        },
      });

      try {
        const [boundary, wards] = await Promise.all([
          fetch(`${API_BASE}/v1/boundaries/hanoi`).then((res) => res.json()),
          fetch(`${API_BASE}/v1/boundaries/wards`).then((res) => res.json()),
        ]);
        wardsRef.current = wards;
        source("hanoi-boundary")?.setData(boundary);
        source("wards")?.setData(wards);
      } finally {
        setBoundariesLoading(false);
      }
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

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.setLayoutProperty("basemap-osm", "visibility", mapTheme === "osm" ? "visible" : "none");
    map.setLayoutProperty("basemap-light", "visibility", mapTheme === "light" ? "visible" : "none");
  }, [mapTheme, mapReady]);

  const source = (id: string) => mapRef.current?.getSource(id) as GeoJSONSource | undefined;

  async function encode(lat: number, lon: number) {
    setLoading(true);
    setError(null);
    setNotice(null);
    setSuggestions([]);
    setActivity("Encoding location");
    try {
      const data = await api<CodeResult>(`/v1/encode?lat=${lat}&lon=${lon}`);
      showResult(data, false, true);
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setLoading(false);
      setActivity(null);
    }
  }

  async function decodeCode(code: string, fly: boolean, updateUrl: boolean, suggestOnError = false) {
    setLoading(true);
    setError(null);
    setNotice(null);
    setSuggestions([]);
    setActivity("Decoding code");
    try {
      const data = await api<CodeResult>(`/v1/decode?code=${encodeURIComponent(code)}`);
      showResult(data, fly, updateUrl);
    } catch (err) {
      setError(messageFromError(err));
      if (suggestOnError) {
        await loadSuggestions(code);
      }
    } finally {
      setLoading(false);
      setActivity(null);
    }
  }

  function showResult(data: CodeResult, fly: boolean, updateUrl: boolean) {
    setResult(data);
    setSuggestions([]);
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
      properties: { label: data.code },
      geometry: { type: "Point", coordinates: [data.center.lon, data.center.lat] },
    });
    source("cell-center")?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [data.center.lon, data.center.lat] },
    });
    source("selected-ward")?.setData(selectedWard(data.admin_unit) ?? emptyCollection);
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

  function selectedWard(adminUnit: CodeResult["admin_unit"]): GeoJSON.FeatureCollection | null {
    const wards = wardsRef.current;
    if (!wards) return null;
    const match = wards.features.find((feature) => {
      const properties = feature.properties ?? {};
      const name = typeof properties.name === "string" ? properties.name : "";
      const id = properties.id ?? properties.admin_unit_id;
      return id === adminUnit.id || adminCodeSlug(name) === adminUnit.slug || name === adminUnit.name;
    });
    return match ? { type: "FeatureCollection", features: [match] } : null;
  }

  async function loadSuggestions(code: string) {
    try {
      const data = await api<{ suggestions: Suggestion[] }>(`/v1/suggest?code=${encodeURIComponent(code)}`);
      setSuggestions(data.suggestions);
    } catch {
      setSuggestions([]);
    }
  }

  async function chooseSuggestion(code: string) {
    setQuery(code);
    await decodeCode(code, true, true, false);
  }

  async function chooseSearchResult(searchResult: SearchResult) {
    setQuery(searchResult.code ?? searchResult.title);
    setSuggestions([]);
    if (searchResult.type === "code" && searchResult.code) {
      await decodeCode(searchResult.code, true, true, false);
      return;
    }
    if (typeof searchResult.lat === "number" && typeof searchResult.lon === "number") {
      mapRef.current?.flyTo({ center: [searchResult.lon, searchResult.lat], zoom: 16, essential: true });
      await encode(searchResult.lat, searchResult.lon);
    }
  }

  return (
    <>
      {!mapReady && <div className="map-fallback">Loading map...</div>}
      <div id="map" />
      <div className="status-stack" aria-live="polite">
        {!mapReady && <div className="status-chip">Loading map</div>}
        {mapReady && boundariesLoading && <div className="status-chip">Loading boundaries</div>}
        {activity && <div className="status-chip">{activity}</div>}
      </div>
      <div className="search">
        <SearchBox query={query} onQueryChange={setQuery} onSelect={chooseSearchResult} busy={loading} />
        <button
          className="theme-toggle"
          type="button"
          onClick={() => setMapTheme((theme) => (theme === "osm" ? "light" : "osm"))}
          aria-label={`Switch to ${mapTheme === "osm" ? "Current Light Style" : "OSM Standard"}`}
          title={mapTheme === "osm" ? "Current Light Style" : "OSM Standard"}
        >
          <Layers size={17} />
        </button>
      </div>
      <aside className="panel">
        <div className="panel-title">
          <Target size={18} />
          <span>{result ? "Shared location" : "Hanoi location code"}</span>
        </div>
        {notice && <div className="notice">{notice}</div>}
        {error && <div className="error">{error}</div>}
        {suggestions.length > 0 && (
          <div className="suggestions">
            <span>Did you mean...</span>
            {suggestions.map((suggestion) => (
              <button type="button" key={suggestion.suggested_code} onClick={() => chooseSuggestion(suggestion.suggested_code)}>
                <strong>{suggestion.suggested_code}</strong>
                <small>{suggestion.reason} · {suggestion.confidence} confidence</small>
              </button>
            ))}
          </div>
        )}
        {!result && !error && <p className="muted">Click inside Hanoi or search a code.</p>}
        {result && (
          <ResultCard
            result={result}
            showNearbyCells={showNearbyCells}
            directionsLoading={directionsLoading}
            onShowNearbyCells={setShowNearbyCells}
            onCopyCode={copyCode}
            onShare={shareResult}
            onDirections={openGoogleMaps}
            onOpenOpenStreetMap={openOpenStreetMap}
            onOpenGoogleMaps={openGoogleMaps}
            onCopyCoordinates={copyCoordinates}
            onCopyLink={copyLink}
            onDirectionsFromMyLocation={directionsFromMyLocation}
          />
        )}
      </aside>
    </>
  );
}

export function SearchBox({
  query,
  onQueryChange,
  onSelect,
  busy,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (result: SearchResult) => void;
  busy: boolean;
}) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setGroups([]);
      setSearching(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/v1/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search failed");
        const data = await response.json() as { groups?: SearchGroup[]; results?: SearchResult[] };
        const nextGroups = data.groups ?? groupSearchResults(data.results ?? []);
        const nextResults = nextGroups.flatMap((group) => group.results);
        setGroups(nextGroups);
        setResults(nextResults);
        setActiveIndex(0);
        setOpen(true);
      } catch (err) {
        if (!controller.signal.aborted) {
          setResults([]);
          setGroups([]);
          setError("Search is unavailable");
          setOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const firstResult = results[0];

  function choose(result: SearchResult) {
    setOpen(false);
    onSelect(result);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (results[activeIndex]) choose(results[activeIndex]);
    else if (firstResult) choose(firstResult);
    else setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Enter" && open && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  }

  return (
    <form className="search-box" onSubmit={handleSubmit}>
      <div className="brand">
        <Target size={18} />
        <span>Hanoi Codes</span>
      </div>
      <div className="search-input-wrap">
        <div className="search-field">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search places, coordinates, codes, or 21.0285, 105.8542"
          />
        </div>
        <div className="search-helper">Try Hồ Gươm or /// tay-ho.khao-di.cay-co</div>
        {open && query.trim().length >= 2 && (
          <div className="search-menu">
            {searching && <div className="search-state">Searching...</div>}
            {error && <div className="search-state error-text">{error}</div>}
            {!searching && !error && results.length === 0 && (
              <div className="search-state">{looksLikeCodeInput(query) ? "Invalid code. No results found." : "No results found"}</div>
            )}
            {!searching && !error && groups.map((group) => (
              <div className="search-group" key={group.type}>
                <div className="search-group-title">{group.title}</div>
                {group.results.map((result) => (
                  <button
                    type="button"
                    className={`search-option ${results[activeIndex]?.id === result.id ? "active" : ""}`}
                    key={result.id}
                    onMouseEnter={() => {
                      const index = results.findIndex((item) => item.id === result.id);
                      if (index >= 0) setActiveIndex(index);
                    }}
                    onClick={() => choose(result)}
                  >
                    <span className="search-option-icon">{typeIcon(result.type)}</span>
                    <span className="search-option-copy">
                      <strong>{searchResultTitle(result)}</strong>
                      <small>{searchResultSubtitle(result)}</small>
                    </span>
                    <em>{resultBadge(result)}</em>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="submit" disabled={busy || searching}>{searching ? "Searching..." : "Search"}</button>
    </form>
  );
}

export function ResultCard({
  result,
  showNearbyCells,
  directionsLoading,
  onShowNearbyCells,
  onCopyCode,
  onShare,
  onDirections,
  onOpenOpenStreetMap,
  onOpenGoogleMaps,
  onCopyCoordinates,
  onCopyLink,
  onDirectionsFromMyLocation,
}: {
  result: CodeResult;
  showNearbyCells: boolean;
  directionsLoading: boolean;
  onShowNearbyCells: (value: boolean) => void;
  onCopyCode: () => void;
  onShare: () => void;
  onDirections: () => void;
  onOpenOpenStreetMap: () => void;
  onOpenGoogleMaps: () => void;
  onCopyCoordinates: () => void;
  onCopyLink: () => void;
  onDirectionsFromMyLocation: () => void;
}) {
  return (
    <div className="result">
      <div className="result-hero">
        <span className="eyebrow">Shared location</span>
        <div className="code-line">
          <span aria-hidden="true">///</span>
          <strong>{result.code}</strong>
        </div>
        <p>{resultContext(result)}</p>
      </div>
      <div className="primary-actions" aria-label="Primary location actions">
        <button type="button" onClick={onCopyCode} className="primary-action">
          <Clipboard size={16} />
          Copy
        </button>
        <button type="button" onClick={onShare} className="primary-action">
          <Share2 size={16} />
          Share
        </button>
        <button type="button" onClick={onDirections} className="primary-action accent">
          <Navigation size={16} />
          Directions
        </button>
      </div>
      <div className="actions" aria-label="Location code actions">
        <button type="button" onClick={onOpenOpenStreetMap}>
          <Navigation size={16} />
          OpenStreetMap
        </button>
        <button type="button" onClick={onOpenGoogleMaps}>
          <ExternalLink size={16} />
          Google Maps
        </button>
        <button type="button" onClick={onCopyCoordinates}>
          <Clipboard size={16} />
          Copy coordinates
        </button>
        <button type="button" onClick={onCopyLink}>
          <Link size={16} />
          Copy link
        </button>
        {supportsGeolocation() && (
          <button type="button" onClick={onDirectionsFromMyLocation} disabled={directionsLoading}>
            <LocateFixed size={16} />
            {directionsLoading ? "Locating..." : "Directions from my location"}
          </button>
        )}
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={showNearbyCells}
          onChange={(event) => onShowNearbyCells(event.target.checked)}
        />
        <span>Show nearby cells</span>
      </label>
      <details className="developer-info">
        <summary>
          <Code2 size={15} />
          Developer info
        </summary>
        <dl>
          {result.clicked && (
            <>
              <dt>Clicked lat/lon</dt>
              <dd>{result.clicked.lat.toFixed(7)}, {result.clicked.lon.toFixed(7)}</dd>
            </>
          )}
          <dt>Center lat/lon</dt>
          <dd>{result.center.lat.toFixed(7)}, {result.center.lon.toFixed(7)}</dd>
          <dt>Admin unit</dt>
          <dd>{result.admin_unit.name} ({result.admin_unit.slug})</dd>
          <dt>Grid version</dt>
          <dd>{result.grid_version}</dd>
          <dt>Cell size</dt>
          <dd>{result.cell_size_m}m</dd>
          <dt>X/Y index</dt>
          <dd>Not exposed by API</dd>
          <dt>Local index</dt>
          <dd>Not exposed by API</dd>
        </dl>
      </details>
    </div>
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

function groupSearchResults(results: SearchResult[]): SearchGroup[] {
  const labels: Record<SearchGroup["type"], string> = {
    codes: "Codes",
    places: "Places",
    coordinates: "Coordinates",
    admin_units: "Admin units",
  };
  const mapType: Record<SearchResult["type"], SearchGroup["type"]> = {
    code: "codes",
    place: "places",
    coordinate: "coordinates",
    admin_unit: "admin_units",
  };
  return (["codes", "places", "coordinates", "admin_units"] as const)
    .map((type) => ({
      type,
      title: labels[type],
      results: results.filter((result) => mapType[result.type] === type),
    }))
    .filter((group) => group.results.length > 0);
}

function searchResultTitle(result: SearchResult): string {
  return result.type === "code" ? (result.code ?? result.title) : result.title;
}

function searchResultSubtitle(result: SearchResult): string {
  if (result.type === "code") {
    return result.subtitle || resultContextFromAdmin(result.admin_unit);
  }
  return result.subtitle || result.admin_unit?.name || result.type;
}

function resultBadge(result: SearchResult): string {
  if (result.type === "code") {
    return result.confidence === "high" ? "CODE" : `CODE · ${result.confidence}`;
  }
  if (result.type === "place") return result.source === "nominatim" ? "PLACE" : result.source;
  if (result.type === "admin_unit") return "ADMIN";
  return "COORD";
}

function typeIcon(type: SearchResult["type"]): string {
  if (type === "code") return "///";
  if (type === "coordinate") return "LL";
  if (type === "admin_unit") return "AU";
  return "POI";
}

function resultContext(result: CodeResult): string {
  return resultContextFromAdmin(result.admin_unit);
}

function resultContextFromAdmin(adminUnit: { name: string; slug: string } | null): string {
  return adminUnit ? `${adminUnit.name}, Hà Nội` : "Hà Nội";
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

function looksLikeCodeInput(value: string): boolean {
  const normalized = normalizeCodeInput(value);
  return normalized.includes(".") || value.includes("/") || normalized.split("-").filter(Boolean).length >= 5;
}

function adminCodeSlug(name: string): string {
  const slug = normalizeCodeInput(name);
  for (const prefix of ["phuong-", "xa-", "thi-tran-"]) {
    if (slug.startsWith(prefix)) return slug.slice(prefix.length);
  }
  return slug;
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

import { Bookmark, Clipboard, Code2, ExternalLink, Link, Navigation, Search, Settings, Share2, Target, X } from "lucide-react";
import maplibregl, { GeoJSONSource, Map } from "maplibre-gl";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

type CellPolygon =
  | GeoJSON.Polygon
  | GeoJSON.MultiPolygon
  | GeoJSON.Feature
  | GeoJSON.FeatureCollection;

type CodeResult = {
  code: string;
  display_code?: string;
  admin_unit: { id: number; name: string; slug: string; area_km2?: number };
  clicked?: { lat: number; lon: number };
  center: { lat: number; lon: number };
  cell_size_m: number;
  grid_version: string;
  x_index?: number;
  y_index?: number;
  local_index?: number;
  word_ids?: number[];
  cell_polygon: CellPolygon;
};

type Suggestion = {
  suggested_code: string;
  display_code?: string;
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

type Basemap = "osm" | "self-hosted";

type ViewportGridResponse = {
  visible: boolean;
  reason: "zoom_too_low" | "too_many_lines" | string | null;
  grid_version?: string;
  cell_size_m?: number;
  line_count?: number;
  grid?: GeoJSON.FeatureCollection<GeoJSON.LineString> | null;
};

type GridDebug = {
  zoom: number;
  visible: boolean;
  verticalLineCount: number;
  horizontalLineCount: number;
  lineCount: number;
  hiddenReason: string | null;
  hiddenCode: "zoom_too_low" | "too_many_lines" | "request_failed" | "not_ready" | null;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const MAP_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL?.trim() ?? "";
const emptyCollection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const GRID_ZOOM_THRESHOLD = 18;
const GRID_HINT = "Zoom in to see the 3m grid";
const GRID_SOURCE_ID = "viewportGrid";
const GRID_LAYER_ID = "viewportGridLayer";
const SELECTED_CELL_SOURCE_ID = "selectedCell";
const SELECTED_CELL_FILL_ID = "selectedCellFill";
const SELECTED_CELL_OUTLINE_ID = "selectedCellOutline";
const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const defaultBasemap: Basemap = MAP_STYLE_URL ? "self-hosted" : "osm";
const SAVED_CODES_KEY = "hanoi-geocode.saved-codes";
const DEBUG_UI = import.meta.env.VITE_DEBUG_UI === "true";

export default function App() {
  const mapRef = useRef<Map | null>(null);
  const wardsRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const boundaryRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const selectedLocationRef = useRef<CodeResult | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const showGridRef = useRef(true);
  const initialCodeRef = useRef(codeFromUrl());
  const [query, setQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<CodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [boundariesLoading, setBoundariesLoading] = useState(true);
  const [activity, setActivity] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<Basemap>(defaultBasemap);
  const [basemapNotice, setBasemapNotice] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchDismissToken, setSearchDismissToken] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [savedCodes, setSavedCodes] = useState<string[]>(() => readSavedCodes());
  const [gridNotice, setGridNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [gridDebug, setGridDebug] = useState<GridDebug>({
    zoom: 10,
    visible: false,
    verticalLineCount: 0,
    horizontalLineCount: 0,
    lineCount: 0,
    hiddenReason: GRID_HINT,
    hiddenCode: "zoom_too_low",
  });

  useEffect(() => {
    const map = new maplibregl.Map({
      container: "map",
      center: [105.84, 21.03],
      zoom: 10,
      minZoom: 9,
      maxZoom: 19,
      style: mapStyleFor(defaultBasemap),
    });
    mapRef.current = map;
    (window as Window & { __hanoiMap?: Map }).__hanoiMap = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");

    map.on("style.load", () => {
      addGeocodeOverlays(map);
      ensureOverlayLayers(map);
      syncMapData();
      syncZoomVisualMode();
      void updateViewportGrid();
    });

    map.on("styledata", () => {
      ensureOverlayLayers(map);
    });

    map.on("load", async () => {
      setMapReady(true);
      ensureOverlayLayers(map);

      try {
        const [boundary, wards] = await Promise.all([
          fetch(`${API_BASE}/v1/boundaries/hanoi`).then((res) => res.json()),
          fetch(`${API_BASE}/v1/boundaries/wards`).then((res) => res.json()),
        ]);
        boundaryRef.current = boundary;
        wardsRef.current = wards;
        syncMapData();
        syncZoomVisualMode();
      } finally {
        setBoundariesLoading(false);
      }
      void updateViewportGrid();
      map.once("idle", () => {
        void updateViewportGrid();
        syncZoomVisualMode();
      });
    });

    map.on("moveend", () => {
      void updateViewportGrid();
      syncZoomVisualMode();
    });
    map.on("zoomend", () => {
      void updateViewportGrid();
      syncZoomVisualMode();
    });

    map.on("click", handleMapClick);

    return () => {
      hideMarker();
      delete (window as Window & { __hanoiMap?: Map }).__hanoiMap;
      map.remove();
    };
  }, []);

  useEffect(() => {
    selectedLocationRef.current = selectedLocation;
    syncZoomVisualMode();
  }, [selectedLocation]);

  useEffect(() => {
    if (!mapReady || !initialCodeRef.current) return;
    const code = initialCodeRef.current;
    initialCodeRef.current = null;
    setQuery(code);
    void decodeCode(code, true, false);
  }, [mapReady]);

  useEffect(() => {
    showGridRef.current = showGrid;
    void updateViewportGrid();
  }, [showGrid, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (basemap === "self-hosted" && !MAP_STYLE_URL) {
      setBasemapNotice("Self-hosted basemap needs VITE_MAP_STYLE_URL in web/.env.local.");
      map.setStyle(mapStyleFor("osm"));
      return;
    }
    setBasemapNotice(null);
    map.setStyle(mapStyleFor(basemap));
    map.once("style.load", () => {
      ensureOverlayLayers(map);
      syncMapData();
      syncZoomVisualMode();
      void updateViewportGrid();
    });
  }, [basemap, mapReady]);

  const source = (id: string) => mapRef.current?.getSource(id) as GeoJSONSource | undefined;

  function syncMapData() {
    const currentResult = selectedLocationRef.current;
    source("hanoi-boundary")?.setData(boundaryRef.current ?? emptyCollection);
    source("wards")?.setData(wardsRef.current ?? emptyCollection);
    source("selected-ward")?.setData(currentResult ? selectedWard(currentResult.admin_unit) ?? emptyCollection : emptyCollection);
  }

  async function encode(lat: number, lon: number, fly = true) {
    setLoading(true);
    setError(null);
    setNotice(null);
    setSuggestions([]);
    setActivity("Encoding location");
    try {
      const data = await api<CodeResult>(`/v1/encode?lat=${lat}&lon=${lon}`);
      showResult(data, fly, true);
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setLoading(false);
      setActivity(null);
    }
  }

  async function encodeFromCurrentLocation(lat: number, lon: number) {
    setLoading(true);
    setError(null);
    setNotice(null);
    setSuggestions([]);
    setActivity("Encoding location");
    try {
      const data = await api<CodeResult>(`/v1/encode?lat=${lat}&lon=${lon}`);
      showResult(data, true, true);
    } catch (err) {
      if (isOutsideSupportedArea(err)) {
        setError("Vị trí hiện tại nằm ngoài khu vực hỗ trợ");
      } else {
        setError(messageFromError(err));
      }
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
    setSelectedLocation(data);
    selectedLocationRef.current = data;
    setSuggestions([]);
    setQuery(data.display_code ?? data.code);
    if (updateUrl) {
      window.history.replaceState(null, "", sharePath(data.code));
    }
    syncMapData();
    syncZoomVisualMode();
    void updateViewportGrid();
    if (fly) {
      const map = mapRef.current;
      map?.flyTo({
        center: [data.center.lon, data.center.lat],
        zoom: Math.max(map.getZoom(), 18.5),
        duration: 500,
        essential: true,
      });
    }
  }

  async function updateViewportGrid() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    ensureOverlayLayers(map);
    const gridSource = map.getSource(GRID_SOURCE_ID) as GeoJSONSource | undefined;
    if (!gridSource) {
      console.warn("Grid source missing");
      return;
    }

    const zoom = map.getZoom();
    if (!showGridRef.current || zoom < GRID_ZOOM_THRESHOLD) {
      gridSource.setData(emptyCollection);
      setGridNotice(showGridRef.current ? GRID_HINT : null);
      setGridDebug({
        zoom,
        visible: false,
        verticalLineCount: 0,
        horizontalLineCount: 0,
        lineCount: 0,
        hiddenReason: showGridRef.current ? GRID_HINT : null,
        hiddenCode: showGridRef.current ? "zoom_too_low" : null,
      });
      return;
    }

    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const lonPad = (east - west) * 0.5;
    const latPad = (north - south) * 0.5;
    const paddedWest = clampLongitude(west - lonPad);
    const paddedEast = clampLongitude(east + lonPad);
    const paddedSouth = clampLatitude(south - latPad);
    const paddedNorth = clampLatitude(north + latPad);
    const url = `${API_BASE}/v1/grid/viewport?west=${paddedWest}&south=${paddedSouth}&east=${paddedEast}&north=${paddedNorth}&zoom=${zoom}`;
    let response: ViewportGridResponse;
    try {
      response = (await fetch(url).then((res) => res.json())) as ViewportGridResponse;
    } catch (error) {
      console.warn("GRID DEBUG", { zoom, error });
      gridSource.setData(emptyCollection);
      setGridNotice(GRID_HINT);
      setGridDebug({
        zoom,
        visible: false,
        verticalLineCount: 0,
        horizontalLineCount: 0,
        lineCount: 0,
        hiddenReason: GRID_HINT,
        hiddenCode: "request_failed",
      });
      return;
    }

    console.log("grid", {
      zoom,
      visible: response.visible,
      reason: response.reason,
      line_count: response.line_count,
      feature_count: response.grid?.features?.length,
    });

    if (!response.visible || !response.grid) {
      gridSource.setData(emptyCollection);
      setGridNotice(GRID_HINT);
      setGridDebug({
        zoom,
        visible: false,
        verticalLineCount: 0,
        horizontalLineCount: 0,
        lineCount: response.line_count ?? 0,
        hiddenReason: GRID_HINT,
        hiddenCode: response.reason === "zoom_too_low" || response.reason === "too_many_lines" ? response.reason : null,
      });
      return;
    }

    gridSource.setData(response.grid);
    const features = response.grid?.features ?? [];
    let verticalLineCount = 0;
    let horizontalLineCount = 0;
    for (const feature of features) {
      const kind = feature.properties?.kind;
      if (kind === "vertical") verticalLineCount += 1;
      if (kind === "horizontal") horizontalLineCount += 1;
    }
    setGridNotice(null);
    setGridDebug({
      zoom,
      visible: true,
      verticalLineCount,
      horizontalLineCount,
      lineCount: response.line_count ?? features.length,
      hiddenReason: null,
      hiddenCode: null,
    });
  }

  async function handleMapClick(event: maplibregl.MapMouseEvent) {
    setSearchDismissToken((token) => token + 1);
    setLoading(true);
    setError(null);
    setNotice(null);
    setSuggestions([]);
    setActivity("Encoding location");
    try {
      const response = await api<CodeResult>(`/v1/encode?lat=${event.lngLat.lat}&lon=${event.lngLat.lng}`);
      const selected: CodeResult = {
        code: response.code,
        display_code: response.display_code,
        center: response.center,
        cell_polygon: response.cell_polygon,
        admin_unit: response.admin_unit,
        clicked: response.clicked,
        cell_size_m: response.cell_size_m,
        grid_version: response.grid_version,
        x_index: response.x_index,
        y_index: response.y_index,
        local_index: response.local_index,
        word_ids: response.word_ids,
      };
      selectedLocationRef.current = selected;
      setSelectedLocation(selected);
      setQuery(selected.display_code ?? selected.code);
      syncMapData();
      syncZoomVisualMode();
      void updateViewportGrid();
    } catch (err) {
      setError(messageFromError(err));
    } finally {
      setLoading(false);
      setActivity(null);
    }
  }

  function showMarker(center: { lat: number; lon: number }) {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      const element = document.createElement("div");
      element.className = "selected-location-marker";
      markerRef.current = new maplibregl.Marker({ element })
        .setLngLat([center.lon, center.lat])
        .addTo(map);
      return;
    }
    markerRef.current.setLngLat([center.lon, center.lat]);
  }

  function hideMarker() {
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }

  function setSelectedCell(cellPolygon: CellPolygon) {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    ensureOverlayLayers(map);
    const source = map.getSource(SELECTED_CELL_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) {
      console.error("selectedCell source missing");
      return;
    }
    const collection = normalizeCellPolygon(cellPolygon);
    source.setData(collection);
  }

  function clearSelectedCell() {
    const map = mapRef.current;
    const source = map?.getSource(SELECTED_CELL_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) {
      source.setData(emptyCollection);
    }
  }

  function syncZoomVisualMode() {
    const map = mapRef.current;
    if (!map) return;
    ensureOverlayLayers(map);
    const zoom = map.getZoom();
    const selected = selectedLocationRef.current;

    if (!selected) {
      clearSelectedCell();
      hideMarker();
      updateCellLabel(null);
      return;
    }

    if (zoom >= GRID_ZOOM_THRESHOLD) {
      hideMarker();
      setSelectedCell(selected.cell_polygon);
      updateCellLabel(selected);
    } else {
      clearSelectedCell();
      showMarker(selected.center);
      updateCellLabel(null);
    }
  }

  function updateCellLabel(selected: CodeResult | null) {
    const map = mapRef.current;
    const labelSource = map?.getSource("cell-label") as GeoJSONSource | undefined;
    if (labelSource) labelSource.setData(selected ? cellLabelFeature(selected) : emptyCollection);
  }

  async function copyCode() {
    if (!selectedLocation) return;
    await copyText(visualCode(selectedLocation));
    setNotice("Đã sao chép");
  }

  async function copyLink() {
    if (!selectedLocation) return;
    await copyText(shareUrl(selectedLocation.code));
    setNotice("Copied link");
  }

  async function shareResult() {
    if (!selectedLocation) return;
    const url = shareUrl(selectedLocation.code);
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Hanoi Codes location",
          text: visualCode(selectedLocation),
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

  async function copyNormalizedCode() {
    if (!selectedLocation) return;
    await copyText(selectedLocation.code);
    setNotice("Copied normalized code");
  }

  function saveResult() {
    if (!selectedLocation) return;
    const next = savedCodes.includes(selectedLocation.code)
      ? savedCodes.filter((code) => code !== selectedLocation.code)
      : [selectedLocation.code, ...savedCodes.filter((code) => code !== selectedLocation.code)].slice(0, 20);
    setSavedCodes(next);
    writeSavedCodes(next);
    setNotice(next.includes(selectedLocation.code) ? "Saved location" : "Removed saved location");
  }

  function openGoogleMaps() {
    if (!selectedLocation) return;
    openExternal(googleMapsSearchUrl(selectedLocation.center));
  }

  function openOpenStreetMap() {
    if (!selectedLocation) return;
    openExternal(openStreetMapUrl(selectedLocation.center));
  }

  async function copyCoordinates() {
    if (!selectedLocation) return;
    await copyText(formatCoordinates(selectedLocation.center));
    setNotice("Copied coordinates");
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
    setQuery(searchResult.display_code ?? searchResult.code ?? searchResult.title);
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

  async function handleUseCurrentLocation() {
    if (!supportsGeolocation()) {
      setError("Trình duyệt không hỗ trợ lấy vị trí hiện tại");
      return;
    }

    setLocating(true);
    setError(null);
    setNotice(null);
    setSuggestions([]);
    setActivity("Đang lấy vị trí");
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
        });
      });
      setActivity(null);
      await encodeFromCurrentLocation(position.coords.latitude, position.coords.longitude);
    } catch (err) {
      setActivity(null);
      if (isGeolocationError(err)) {
        setError(messageFromGeolocationError(err));
      } else {
        setError("Không thể lấy vị trí hiện tại");
      }
    } finally {
      setLocating(false);
    }
  }

  return (
    <>
      {!mapReady && <div className="map-fallback">Loading map...</div>}
      <div id="map" />
      <header className="app-topbar">
        <div className="brand">
          <span className="brand-mark">///</span>
          <span className="brand-text">Hanoi Codes</span>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="settings-button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Open settings"
            aria-expanded={isSettingsOpen}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>
      {isSettingsOpen && (
        <button
          type="button"
          className="settings-backdrop"
          aria-label="Close settings"
          onClick={() => setIsSettingsOpen(false)}
        />
      )}
      <aside className={`settings-panel ${isSettingsOpen ? "open" : ""}`} aria-hidden={!isSettingsOpen}>
        <div className="settings-header">
          <div className="settings-title">
            <Settings size={18} />
            <span>Settings</span>
          </div>
          <button type="button" className="settings-close" onClick={() => setIsSettingsOpen(false)} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="settings-section">
          <span className="settings-label">Map type</span>
          <div className="settings-options">
            <button
              type="button"
              className={`settings-option ${basemap === "osm" ? "active" : ""}`}
              onClick={() => setBasemap("osm")}
            >
              OSM Standard
            </button>
            <button
              type="button"
              className={`settings-option ${basemap === "self-hosted" ? "active" : ""}`}
              onClick={() => setBasemap("self-hosted")}
            >
              Self-hosted
            </button>
          </div>
        </div>
        <div className="settings-section">
          <span className="settings-label">3 word address language</span>
          <div className="settings-row">
            <span>Vietnamese</span>
            <span className="settings-note">Default</span>
          </div>
        </div>
        <div className="settings-section">
          <span className="settings-label">Saved locations</span>
          {savedCodes.length === 0 ? (
            <div className="settings-row muted">No saved locations</div>
          ) : (
            <div className="saved-list">
              {savedCodes.slice(0, 6).map((code) => (
                <button type="button" key={code} onClick={() => decodeCode(code, true, true, false)}>
                  /// {code}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
      <div className="status-stack" aria-live="polite">
        {!mapReady && <div className="status-chip">Loading map</div>}
        {mapReady && boundariesLoading && <div className="status-chip">Loading boundaries</div>}
        {activity && <div className="status-chip">{activity}</div>}
        {showGrid && gridNotice && <div className="status-chip">{gridNotice}</div>}
      </div>
      <div className="left-panel">
        <div className="search-card">
          <SearchBox
            query={query}
            onQueryChange={setQuery}
            onSelect={chooseSearchResult}
            onLocate={handleUseCurrentLocation}
            busy={loading}
            locating={locating}
            dismissToken={searchDismissToken}
          />
        </div>
        <aside className="panel">
          <div className="panel-title">
            <Target size={18} />
            <span>{selectedLocation ? "Shared location" : "Hanoi location code"}</span>
          </div>
          {basemapNotice && <div className="error">{basemapNotice}</div>}
          {notice && <div className="notice">{notice}</div>}
          {error && <div className="error">{error}</div>}
          {suggestions.length > 0 && (
            <div className="suggestions">
              <span>Did you mean...</span>
              {suggestions.map((suggestion) => (
                <button type="button" key={suggestion.suggested_code} onClick={() => chooseSuggestion(suggestion.suggested_code)}>
                  <strong>/// {suggestion.display_code ?? suggestion.suggested_code}</strong>
                  <small>{suggestion.reason} · {suggestion.confidence} confidence</small>
                </button>
              ))}
            </div>
          )}
          {!selectedLocation && !error && <p className="muted">Click inside Hanoi or search a code.</p>}
          {selectedLocation && (
            <ResultCard
              result={selectedLocation}
              gridDebug={gridDebug}
              saved={savedCodes.includes(selectedLocation.code)}
              onCopyCode={copyCode}
              onCopyNormalizedCode={copyNormalizedCode}
              onShare={shareResult}
              onDirections={openGoogleMaps}
              onSave={saveResult}
              onOpenOpenStreetMap={openOpenStreetMap}
              onOpenGoogleMaps={openGoogleMaps}
              onCopyCoordinates={copyCoordinates}
              onCopyLink={copyLink}
              showDebug={DEBUG_UI}
            />
          )}
        </aside>
      </div>
    </>
  );
}

export function SearchBox({
  query,
  onQueryChange,
  onSelect,
  onLocate,
  busy,
  locating,
  dismissToken,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (result: SearchResult) => void;
  onLocate: () => void;
  busy: boolean;
  locating: boolean;
  dismissToken: number;
}) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ignoreBlurRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setOpen(false);
    setHasFocus(false);
    setSearching(false);
    setError(null);
  }, [dismissToken]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!hasFocus) {
      setOpen(false);
      setSearching(false);
      return;
    }
    if (trimmed.length === 0) {
      setResults([]);
      setGroups([]);
      setSearching(false);
      setError(null);
      setOpen(false);
      return;
    }
    if (trimmed.length < 2) {
      setResults([]);
      setGroups([]);
      setSearching(false);
      setError(null);
      setOpen(true);
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
  }, [query, hasFocus]);

  const firstResult = results[0];

  function choose(result: SearchResult) {
    setOpen(false);
    setHasFocus(false);
    onSelect(result);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (results[activeIndex]) choose(results[activeIndex]);
    else if (firstResult) choose(firstResult);
    else {
      setError("No result found");
      setOpen(true);
    }
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
      setHasFocus(false);
    } else if (event.key === "Enter" && open && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  }

  return (
    <form className="search-box" onSubmit={handleSubmit} aria-busy={busy}>
      <div className="search-input-wrap">
        <div className="search-input-shell">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setHasFocus(true);
              setOpen(true);
            }}
            onBlur={() => {
              if (ignoreBlurRef.current) {
                ignoreBlurRef.current = false;
                return;
              }
              setOpen(false);
              setHasFocus(false);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search a place or /// code"
          />
          {query.trim().length > 0 && (
            <button
              type="button"
              className="clear-button"
              aria-label="Clear search"
              onClick={() => {
                onQueryChange("");
                setResults([]);
                setGroups([]);
                setSearching(false);
                setError(null);
                setOpen(false);
                inputRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
          {open && hasFocus && query.trim().length > 0 && (
            <div
              className="search-menu"
              onMouseDown={() => {
                ignoreBlurRef.current = true;
              }}
              onMouseUp={() => {
                window.setTimeout(() => {
                  ignoreBlurRef.current = false;
                }, 0);
              }}
            >
              {query.trim().length < 2 && <div className="search-state">Keep typing to see results</div>}
              {query.trim().length >= 2 && searching && <div className="search-state">Searching...</div>}
              {query.trim().length >= 2 && error && <div className="search-state error-text">{error}</div>}
              {query.trim().length >= 2 && !searching && !error && results.length === 0 && (
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
        {hasFocus && query.trim().length === 0 && (
          <div className="search-helper">Try Hồ Gươm or /// Thanh Xuân.vùng lành hai.trường chinh</div>
        )}
      </div>
      <button
        type="button"
        className={`my-location-button ${locating ? "loading" : ""}`}
        onClick={onLocate}
        disabled={locating}
      >
        {locating ? <span className="spinner" aria-hidden="true" /> : <span className="location-icon">◎</span>}
        {locating ? "Đang định vị..." : "Vị trí của tôi"}
      </button>
    </form>
  );
}

export function ResultCard({
  result,
  gridDebug,
  saved,
  onCopyCode,
  onCopyNormalizedCode,
  onShare,
  onDirections,
  onSave,
  onOpenOpenStreetMap,
  onOpenGoogleMaps,
  onCopyCoordinates,
  onCopyLink,
  showDebug,
}: {
  result: CodeResult;
  gridDebug: GridDebug;
  saved: boolean;
  onCopyCode: () => void;
  onCopyNormalizedCode: () => void;
  onShare: () => void;
  onDirections: () => void;
  onSave: () => void;
  onOpenOpenStreetMap: () => void;
  onOpenGoogleMaps: () => void;
  onCopyCoordinates: () => void;
  onCopyLink: () => void;
  showDebug: boolean;
}) {
  return (
    <div className="result">
      <div className="result-hero">
        <span className="eyebrow">Shared location</span>
        <div className="code-line">
          <span aria-hidden="true">///</span>
          <strong>{displayCode(result)}</strong>
          <button type="button" className="code-copy" onClick={onCopyCode} aria-label="Copy code">
            <Clipboard size={16} />
          </button>
        </div>
        <p>{resultContext(result)}</p>
      </div>
      <div className="primary-actions" aria-label="Primary location actions">
        <button type="button" onClick={onShare} className="primary-action">
          <Share2 size={16} />
          Share
        </button>
        <button type="button" onClick={onDirections} className="primary-action accent">
          <Navigation size={16} />
          Navigate
        </button>
        <button type="button" onClick={onSave} className={`primary-action ${saved ? "saved" : ""}`} aria-pressed={saved}>
          <Bookmark size={16} />
          Save
        </button>
      </div>
      <details className="secondary-actions">
        <summary>More options</summary>
        <div className="actions" aria-label="Secondary location actions">
          <button type="button" onClick={onCopyCode}>
            <Clipboard size={16} />
            Copy code
          </button>
          <button type="button" onClick={onCopyLink}>
            <Link size={16} />
            Copy link
          </button>
          <button type="button" onClick={onCopyCoordinates}>
            <Clipboard size={16} />
            Copy coordinates
          </button>
          <button type="button" onClick={onOpenOpenStreetMap}>
            <Navigation size={16} />
            OpenStreetMap
          </button>
          <button type="button" onClick={onOpenGoogleMaps}>
            <ExternalLink size={16} />
            Google Maps
          </button>
        </div>
      </details>
      {showDebug && (
        <details className="developer-info">
          <summary>
            <Code2 size={15} />
            Developer info
          </summary>
          <dl>
            <dt>Normalized code</dt>
            <dd>
              <button type="button" className="inline-copy" onClick={onCopyNormalizedCode}>{result.code}</button>
            </dd>
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
            <dd>{result.x_index ?? "Not exposed"} / {result.y_index ?? "Not exposed"}</dd>
            <dt>Local index</dt>
            <dd>{result.local_index ?? "Not exposed"}</dd>
            <dt>Word ids</dt>
            <dd>{result.word_ids?.join(", ") ?? "Not exposed"}</dd>
            <dt>Grid visible</dt>
            <dd>{String(gridDebug.visible)}</dd>
            <dt>Grid zoom</dt>
            <dd>{gridDebug.zoom.toFixed(2)}</dd>
            <dt>Grid lines</dt>
            <dd>{gridDebug.verticalLineCount} vertical / {gridDebug.horizontalLineCount} horizontal / {gridDebug.lineCount} total</dd>
            <dt>Grid hidden reason</dt>
            <dd>{gridDebug.hiddenCode ?? gridDebug.hiddenReason ?? "none"}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}

function mapStyleFor(basemap: Basemap): maplibregl.StyleSpecification | string {
  if (basemap === "self-hosted" && MAP_STYLE_URL) return MAP_STYLE_URL;
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: osmAttribution,
      },
    },
    layers: [{ id: "basemap-osm", type: "raster", source: "osm" }],
  };
}

function ensureOverlayLayers(map: Map) {
  if (!map.isStyleLoaded()) return;

  if (!map.getSource(GRID_SOURCE_ID)) map.addSource(GRID_SOURCE_ID, { type: "geojson", data: emptyCollection });
  if (!map.getLayer(GRID_LAYER_ID)) {
    map.addLayer({
      id: GRID_LAYER_ID,
      type: "line",
      source: GRID_SOURCE_ID,
      minzoom: GRID_ZOOM_THRESHOLD,
      paint: {
        "line-color": "#334155",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 18, 0.12, 19, 0.16, 20, 0.2],
        "line-width": ["interpolate", ["linear"], ["zoom"], 18, 0.5, 19, 0.6, 20, 0.8],
      },
    });
  }

  if (!map.getSource(SELECTED_CELL_SOURCE_ID)) map.addSource(SELECTED_CELL_SOURCE_ID, { type: "geojson", data: emptyCollection });
  if (!map.getLayer(SELECTED_CELL_FILL_ID)) {
    map.addLayer({
      id: SELECTED_CELL_FILL_ID,
      type: "fill",
      source: SELECTED_CELL_SOURCE_ID,
      minzoom: GRID_ZOOM_THRESHOLD,
      paint: { "fill-color": "#ff00ff", "fill-opacity": 0.35 },
    });
  }
  if (!map.getLayer(SELECTED_CELL_OUTLINE_ID)) {
    map.addLayer({
      id: SELECTED_CELL_OUTLINE_ID,
      type: "line",
      source: SELECTED_CELL_SOURCE_ID,
      minzoom: GRID_ZOOM_THRESHOLD,
      paint: { "line-color": "#ff00ff", "line-opacity": 1, "line-width": 4 },
    });
  }

  moveLayerToTop(map, GRID_LAYER_ID);
  moveLayerToTop(map, SELECTED_CELL_FILL_ID);
  moveLayerToTop(map, SELECTED_CELL_OUTLINE_ID);
}

function moveLayerToTop(map: Map, layerId: string) {
  if (!map.getLayer(layerId)) return;
  try {
    map.moveLayer(layerId);
  } catch (error) {
    console.warn("Could not move layer", layerId, error);
  }
}

function addGeocodeOverlays(map: Map) {
  if (!map.getSource("hanoi-boundary")) map.addSource("hanoi-boundary", { type: "geojson", data: emptyCollection });
  if (!map.getSource("wards")) map.addSource("wards", { type: "geojson", data: emptyCollection });
  if (!map.getSource("selected-ward")) map.addSource("selected-ward", { type: "geojson", data: emptyCollection });
  if (!map.getSource("cell-label")) map.addSource("cell-label", { type: "geojson", data: emptyCollection });

  if (!map.getLayer("hanoi-boundary-fill")) {
    map.addLayer({
      id: "hanoi-boundary-fill",
      type: "fill",
      source: "hanoi-boundary",
      paint: { "fill-color": "#5b6b75", "fill-opacity": 0.018 },
    });
  }
  if (!map.getLayer("wards-line")) {
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
  }
  if (!map.getLayer("selected-ward-fill")) {
    map.addLayer({
      id: "selected-ward-fill",
      type: "fill",
      source: "selected-ward",
      paint: { "fill-color": "#007a5a", "fill-opacity": 0.08 },
    });
  }
  if (!map.getLayer("selected-ward-line")) {
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
  }
  if (!map.getLayer("hanoi-boundary-line")) {
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
  }
  if (!map.getLayer("cell-label")) {
    map.addLayer({
      id: "cell-label",
      type: "symbol",
      source: "cell-label",
      minzoom: GRID_ZOOM_THRESHOLD,
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
  }
}

function cellLabelFeature(result: CodeResult): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: "Feature",
    properties: { label: displayCode(result) },
    geometry: { type: "Point", coordinates: [result.center.lon, result.center.lat] },
  };
}

function normalizeCellPolygon(cellPolygon: CellPolygon): GeoJSON.FeatureCollection {
  if (!cellPolygon || typeof cellPolygon !== "object") return emptyCollection;
  if (cellPolygon.type === "FeatureCollection") return cellPolygon as GeoJSON.FeatureCollection;
  if (cellPolygon.type === "Feature") {
    return { type: "FeatureCollection", features: [cellPolygon as GeoJSON.Feature] };
  }
  if (cellPolygon.type === "Polygon" || cellPolygon.type === "MultiPolygon") {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: cellPolygon as GeoJSON.Geometry }],
    };
  }
  return emptyCollection;
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
  return `/?code=${encodeURIComponent(code)}`;
}

function shareUrl(code: string): string {
  return new URL(sharePath(code), window.location.origin).toString();
}

function readSavedCodes(): string[] {
  try {
    const raw = window.localStorage.getItem(SAVED_CODES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((code): code is string => typeof code === "string") : [];
  } catch {
    return [];
  }
}

function writeSavedCodes(codes: string[]) {
  window.localStorage.setItem(SAVED_CODES_KEY, JSON.stringify(codes));
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
  return result.type === "code" ? `/// ${result.display_code ?? result.title ?? result.code}` : result.title;
}

function searchResultSubtitle(result: SearchResult): string {
  if (result.type === "code") {
    return result.subtitle || resultContextFromAdmin(result.admin_unit);
  }
  return result.subtitle || result.admin_unit?.name || result.type;
}

function resultBadge(result: SearchResult): string {
  if (result.type === "code") {
    return "CODE";
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

function displayCode(result: { code: string; display_code?: string | null }): string {
  return result.display_code || result.code;
}

function visualCode(result: { code: string; display_code?: string | null }): string {
  return `/// ${displayCode(result)}`;
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
  if (error.code === error.PERMISSION_DENIED) return "Bạn cần cho phép truy cập vị trí để dùng tính năng này";
  if (error.code === error.POSITION_UNAVAILABLE) return "Không thể lấy vị trí hiện tại";
  if (error.code === error.TIMEOUT) return "Lấy vị trí quá lâu, vui lòng thử lại";
  return "Không thể lấy vị trí hiện tại";
}

function isGeolocationError(error: unknown): error is GeolocationPositionError {
  return typeof error === "object" && error !== null && "code" in error;
}

function isOutsideSupportedArea(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "OUT_OF_SUPPORTED_AREA" || error.code === "CELL_NOT_ASSIGNED" || error.code === "CODE_NOT_ASSIGNED")
  );
}

function shortCode(code: string): string {
  const parts = code.split(".");
  return parts.length === 3 ? `${parts[1]}.${parts[2]}` : code;
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

function clampLatitude(value: number): number {
  return Math.max(-85, Math.min(85, value));
}

function clampLongitude(value: number): number {
  return Math.max(-180, Math.min(180, value));
}

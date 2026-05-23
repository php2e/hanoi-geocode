# Architecture

The demo has three layers:

- FastAPI backend for encode/decode and boundary endpoints.
- PostgreSQL/PostGIS for authoritative polygons, active words, grid metadata, row intervals, and code parameters.
- Vite React frontend with MapLibre GL JS for interactive map display.

Requests do not generate random words and do not read from a cache-only decode table. Encode and decode both use the same persisted grid version, compressed row intervals, active word IDs, and deterministic permutation parameters.

The database stores ward/commune polygons in EPSG:4326 for public coordinate lookup and EPSG:32648 for meter-based grid construction. The frontend renders administrative boundaries and only the selected 3m cell polygon by default.

## Basemap Tiles

The frontend uses MapLibre with keyless CARTO raster basemaps for light and dark modes. Tile attribution is shown in the map control as OpenStreetMap contributors and CARTO.

These public tiles are suitable for local demos and development, but they are still external public services. Production deployments should review CARTO/OpenStreetMap usage policies, cache behavior, availability expectations, and whether a dedicated tile provider or self-hosted basemap is needed.

## Grid Visualization

The app intentionally avoids rendering the full 3m grid. A full-city 3m grid would contain too many cells for a smooth browser map, create unnecessary network and GPU work, and visually overwhelm the administrative boundaries and selected result.

Instead, encode/decode responses include the selected cell polygon. The frontend draws that single cell with a clear outline, zoom-aware fill, a center marker, and a short code label. At high zoom, users can optionally show a small 3x3 neighborhood derived from the selected polygon. This keeps the visualization useful for spatial context while capping nearby-cell rendering well below 25 polygons and preserving the backend geocoding algorithm as the source of truth.

## Phase 1 Routing Integration

Routing is intentionally delegated to external map apps in this phase. The result panel can open the decoded cell center in Google Maps or OpenStreetMap, copy the center coordinates, and request browser geolocation only when the user clicks "Directions from my location." The app then opens Google Maps directions from the browser-provided origin to the selected cell center.

The project does not run a custom routing engine yet. Keeping Phase 1 as URL-based integration avoids collecting location data on page load, keeps route quality in mature map products, and preserves the backend geocoding algorithm unchanged.

## Search Provider

`/v1/search` is the unified search entrypoint for the frontend. It handles exact/fuzzy location-code search, coordinate parsing, local admin-unit lookup, and provider-backed place/address search.

Search is split into small backend providers:

- `CodeSearchProvider` normalizes code-like input, tries exact decode first, then returns fuzzy suggestions that still decode to assigned cells.
- `CoordinateSearchProvider` parses latitude/longitude input and encodes points in the supported area.
- `AdminUnitSearchProvider` searches local ward/commune names and slugs without any external dependency.
- `PlaceSearchProvider` is the replaceable interface for normal place/address geocoding.

`/v1/code-suggestions` exposes the code-only provider for clients that want what3words-style suggestions without place search. Parsing uses known admin-unit slugs so multi-word slugs such as `van-mieu-quoc-tu-giam` are not split incorrectly. Fuzzy ranking prefers exact admin matches, exact/prefix word matches, low edit distance, and valid assigned decoded cells. The API does not auto-correct or navigate; users must choose a suggestion.

The frontend formats code suggestions like a consumer location product: normalized code as the title, `///` as a visual prefix only, and a short context subtitle. Developer-oriented details such as match reasons, grid version, coordinates, and cell size are hidden by default in the result card and remain available in a collapsible developer section.

Place search is isolated behind the `PlaceSearchProvider` interface. The first implementation proxies Nominatim/OpenStreetMap from the backend with Vietnam country filtering, a Hanoi viewbox, bounded search, and Vietnamese language preference. This keeps provider-specific behavior out of the frontend and makes it easier to replace Nominatim with Google Places, Mapbox, HERE, Photon, Pelias, a private geocoder, or an internal POI service later.

Nominatim is suitable for demos and light development, not Google Maps-equivalent search. Deployments should review Nominatim usage policy, rate limits, attribution, caching rules, and service availability before enabling public use. Rich reverse-address context should be fetched and cached after explicit user interaction, not during every suggestion keystroke.

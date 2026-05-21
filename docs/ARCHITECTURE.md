# Architecture

The demo has three layers:

- FastAPI backend for encode/decode and boundary endpoints.
- PostgreSQL/PostGIS for authoritative polygons, active words, grid metadata, row intervals, and code parameters.
- Vite React frontend with MapLibre GL JS for interactive map display.

Requests do not generate random words and do not read from a cache-only decode table. Encode and decode both use the same persisted grid version, compressed row intervals, active word IDs, and deterministic permutation parameters.

The database stores ward/commune polygons in EPSG:4326 for public coordinate lookup and EPSG:32648 for meter-based grid construction. The frontend renders administrative boundaries and only the selected 3m cell polygon by default.

## Grid Visualization

The app intentionally avoids rendering the full 3m grid. A full-city 3m grid would contain too many cells for a smooth browser map, create unnecessary network and GPU work, and visually overwhelm the administrative boundaries and selected result.

Instead, encode/decode responses include the selected cell polygon. The frontend draws that single cell with a clear outline, zoom-aware fill, a center marker, and a short code label. At high zoom, users can optionally show a small 3x3 neighborhood derived from the selected polygon. This keeps the visualization useful for spatial context while capping nearby-cell rendering well below 25 polygons and preserving the backend geocoding algorithm as the source of truth.

## Phase 1 Routing Integration

Routing is intentionally delegated to external map apps in this phase. The result panel can open the decoded cell center in Google Maps or OpenStreetMap, copy the center coordinates, and request browser geolocation only when the user clicks "Directions from my location." The app then opens Google Maps directions from the browser-provided origin to the selected cell center.

The project does not run a custom routing engine yet. Keeping Phase 1 as URL-based integration avoids collecting location data on page load, keeps route quality in mature map products, and preserves the backend geocoding algorithm unchanged.

# Architecture

The demo has three layers:

- FastAPI backend for encode/decode and boundary endpoints.
- PostgreSQL/PostGIS for authoritative polygons, active words, grid metadata, row intervals, and code parameters.
- Vite React frontend with MapLibre GL JS for interactive map display.

Requests do not generate random words and do not read from a cache-only decode table. Encode and decode both use the same persisted grid version, compressed row intervals, active word IDs, and deterministic permutation parameters.

The database stores ward/commune polygons in EPSG:4326 for public coordinate lookup and EPSG:32648 for meter-based grid construction. The frontend renders administrative boundaries and only the selected 3m cell polygon.

# Hanoi Location Code Demo

A production-oriented web demo for deterministic Hanoi location codes in the form:

```text
<ward-or-commune>.<word1>.<word2>
```

The app displays Hanoi and ward/commune boundaries, lets a user click a point, assigns the point to a 3m x 3m EPSG:32648 grid cell, and returns a reversible code. Search decodes the code back to the cell center and polygon.

## Folder Structure

- `backend/`: FastAPI app, PostGIS schema, geocoding services, import/build scripts, tests.
- `web/`: Vite React + TypeScript + MapLibre GL JS demo.
- `data/`: canonical local inputs: `hanoi_bound_2026.geojson`, `hanoi_wards_2026.geojson`, and curated word sources such as `model_v10/top_3000_words.csv`.
- `docs/`: architecture, geocore, data assumptions, limitations.

## Prerequisites

- Docker and Docker Compose
- Python 3.11+
- Node.js 20+

## Run

```bash
make db-up
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cd ..
make migrate
make import-admin
make import-words
make build-grid
make backend
```

`make import-words` defaults to `data/model_v10/all_ranked_words.csv`, reads the `word` column, and imports the top `3071` ranked rows. You can point it at another curated source or top-N size without code changes:

```bash
make import-words WORDS_PATH=../data/model_v10/all_ranked_words.csv WORDS_COLUMN=word WORDS_LIMIT=5000
```

CSV and plain-text word sources are both supported. CSV import auto-detects common columns such as `word` and `normalized_word`; use `WORDS_COLUMN=...` when a file has a custom schema. Replacing the word list invalidates existing grid/code metadata, so run `make build-grid` after every source change.

For the current 3m Hanoi grid, the active normalized word list must contain at least `2988` unique slugs. The checked-in `top_3000_words.csv` has 3000 rows, but only 2924 unique normalized slugs because some accented words collapse to the same code slug. In `all_ranked_words.csv`, the top 3071 rows are the first point that yields 2988 unique normalized slugs.

In another terminal:

```bash
cd web
npm install
VITE_API_BASE=http://localhost:8000 npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

## Shareable Codes

After clicking a Hanoi location or searching a code, the result panel includes buttons to copy the code, copy a shareable link, share through the browser share sheet when supported, and a placeholder for opening directions.

Shared URLs can use either route style:

```text
http://localhost:5173/c/ba-vi.ao-mua.cay-da
http://localhost:5173/?code=ba-vi.ao-mua.cay-da
```

Opening either URL automatically decodes the code, moves the map to the decoded cell, and shows the result panel.

## Unified Search

The web app uses one search box for Hanoi location codes, coordinates, admin units, and place/address search. The backend endpoint is:

```text
GET /v1/search?q=<query>
```

It returns grouped suggestions for the dropdown:

```json
{
  "query": "ba-vi.ao-mua.cay-da",
  "groups": [
    {
      "type": "codes",
      "title": "Codes",
      "results": []
    }
  ]
}
```

Search behavior:

- Code-like input is normalized and decoded exactly first. If exact decode fails, fuzzy code suggestions are returned, but the app never auto-navigates to a correction.
- Dedicated code suggestions are also available from `GET /v1/code-suggestions?q=<query>&limit=8`.
- Code input accepts accented display text, ASCII slugs, spaces, dots, slashes, and optional leading `///`, for example `Ba Vì.áo mưa.cây đa`, `ba vi ao mua cay da`, and `ba-vi/ao-mua/cay-da`.
- Coordinate input such as `21.0285, 105.8542` is encoded when it falls in the supported area.
- Admin unit names/slugs are matched from the local `admin_units` table and return a point inside the unit.
- Place/address results are supplied through provider classes on the backend: code, coordinate, admin unit, and place search. The demo place provider uses Nominatim/OpenStreetMap through the backend.

Code suggestions only return codes that decode to valid assigned cells. The dropdown intentionally shows clean user-facing text: the normalized code as the title and one short context line such as `Xã Ba Vì, Hà Nội`. Internal fields like `match_reason` are kept for debugging and ranking, but the UI does not show repeated admin/display-code text.

Suggestion subtitles use local admin-unit context by default. Richer reverse-geocoded context should be cached or fetched after deliberate user interaction, such as selecting a result, not on every keystroke.

Nominatim is included for demos and development only. It is not Google Maps: coverage, ranking, POI freshness, rate limits, availability, and address matching will differ. Production deployments should replace or augment the provider with Google Places, Mapbox, HERE, Photon, Pelias, a private geocoder, or an internal POI service, and should avoid high-volume anonymous traffic.

## PWA Support

The web app includes a basic PWA manifest and service worker. Supported browsers can install it as "Hanoi Codes" with placeholder icons and the app theme color.

The service worker caches only same-origin static assets: the app shell, built JS/CSS assets, manifest, icons, and `offline.html`. It intentionally does not cache `/v1/*` API responses, database-backed geocoding results, or external map tiles.

Offline limitations:

- Encode/decode still requires the backend.
- Shared code URLs still need the backend to resolve a cell.
- Basemap tiles and boundary data may be unavailable offline.
- The offline page is a fallback shell, not full offline geocoding.

## Map Tiles

The default basemap is OpenStreetMap Standard/Carto raster tiles:

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

These public tiles are fine for local demos and small testing. Keep the visible `© OpenStreetMap contributors` attribution. For production deployments, public launches, or heavier traffic, use a dedicated tile provider or self-host tiles instead of relying on the public OpenStreetMap tile service.

If Docker fails to create a bridge network with a `veth` error, use the host-network fallback on Linux:

```bash
make db-up-host
make backend
```

Both database targets expose Postgres on `localhost:15432`, which matches the default `DATABASE_URL` in the `Makefile`.

## Faster Development Grid

The full 3m interval build is offline work and can take time. Build one ward first:

```bash
cd backend
python -m scripts.build_grid_intervals --cell-size 3 --limit-admin-slug phuc-loi --rebuild
```

Only that admin unit will encode/decode until the full build is run.

## Testing

```bash
cd backend
pytest
```

Dataset validation after imports and grid build:

```bash
make validate
```

## Geocode Validation

Run a larger encode/decode stability check after imports and grid build:

```bash
cd backend
python -m scripts.validate_geocode --samples 10000
```

The validator samples random points inside admin unit polygons, encodes each point, decodes the returned code, encodes the decoded center again, and checks that the code remains stable. For normal interior points more than 3m from a ward boundary, it also verifies that the decoded center is within 3m of the original point.

It also checks boundary and error cases: outside-Hanoi points, exact and near ward-boundary points, invalid code format, unknown words, and unknown admin units. The summary prints p50/p95 encode and decode latency measured around the backend geocode functions.

Failures are written to `geocode_validation_failures.csv` by default. A non-empty report means at least one sampled point or boundary/error case did not meet expectations. Inspect the `case`, `code`, coordinates, and `detail` columns first. Boundary-adjacent failures are often data/grid assignment edge cases; interior `roundtrip_*` or `decoded_center_too_far` failures are higher priority because they may indicate broken reversibility or grid consistency.

## Troubleshooting

- `make db-up` fails with `failed to add the host ... veth ... operation not supported`: run `make db-up-host` instead. This avoids Docker bridge networking and keeps the same database volume.
- Backend `/health` is `ok` but encode/decode fails: `/health` only checks that FastAPI is running. Check Postgres and loaded data with `make db-check`, then make sure the backend was started with `DATABASE_URL=postgresql://hanoi:hanoi@localhost:15432/hanoi_geocode` or `make backend`.
- `GRID_NOT_BUILT`: run `make build-grid`.
- `OUT_OF_SUPPORTED_AREA`: the point is outside ward/commune polygons or the clicked cell center is outside its ward.
- `UNKNOWN_WORD`: run `make import-words`, or the searched word failed validation.
- Import path errors: this repo uses the canonical files currently present in `data/`, not the placeholder names from the initial product brief.

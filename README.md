# Hanoi Location Code Demo

A production-oriented web demo for deterministic Hanoi location codes in the form:

```text
<ward-or-commune>.<word1>.<word2>
```

The app displays Hanoi and ward/commune boundaries, lets a user click a point, assigns the point to a 3m x 3m EPSG:32648 grid cell, and returns a reversible code. Search decodes the code back to the cell center and polygon.

## Folder Structure

- `backend/`: FastAPI app, PostGIS schema, geocoding services, import/build scripts, tests.
- `web/`: Vite React + TypeScript + MapLibre GL JS demo.
- `data/`: canonical local inputs: `hanoi_bound_2026.geojson`, `hanoi_wards_2026.geojson`, `vi_wiktionary_pos.txt`.
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

## Troubleshooting

- `make db-up` fails with `failed to add the host ... veth ... operation not supported`: run `make db-up-host` instead. This avoids Docker bridge networking and keeps the same database volume.
- Backend `/health` is `ok` but encode/decode fails: `/health` only checks that FastAPI is running. Check Postgres and loaded data with `make db-check`, then make sure the backend was started with `DATABASE_URL=postgresql://hanoi:hanoi@localhost:15432/hanoi_geocode` or `make backend`.
- `GRID_NOT_BUILT`: run `make build-grid`.
- `OUT_OF_SUPPORTED_AREA`: the point is outside ward/commune polygons or the clicked cell center is outside its ward.
- `UNKNOWN_WORD`: run `make import-words`, or the searched word failed validation.
- Import path errors: this repo uses the canonical files currently present in `data/`, not the placeholder names from the initial product brief.

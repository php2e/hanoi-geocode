# Tile Data

This project supports an optional self-hosted basemap for the MapLibre frontend.

## Generated MBTiles

The generated vector MBTiles file is:

```text
tiles/generated/hanoi-osm-2026.mbtiles
```

The detailed self-hosted style is:

```text
tiles/generated/styles/hanoi-detailed/style.json
http://localhost:8080/styles/hanoi-detailed/style.json
```

`tiles/generated/config.json` registers this style with TileServer GL and keeps the vector tile data identifier as `v3`.

This tile data is only for basemap rendering. It is not used by geocoding, encode/decode, grid interval logic, or search providers. Those features continue to use the backend database and API services.

## Run TileServer GL

Start TileServer GL with Docker Compose:

```bash
make tiles-up
```

This runs the `tileserver` service from `docker-compose.yml`:

```yaml
tileserver:
  image: maptiler/tileserver-gl
  ports:
    - "8080:8080"
  volumes:
    - ./tiles/generated:/data
  restart: unless-stopped
```

Open this URL to confirm TileServer GL is running:

```text
http://localhost:8080
```

Useful commands:

```bash
make tiles-logs
make tiles-down
```

## Configure The Web App

Create `web/.env.local`:

```text
VITE_API_BASE=http://localhost:8000
VITE_MAP_STYLE_URL=http://localhost:8080/styles/hanoi-detailed/style.json
```

Then start the frontend:

```bash
cd web
npm run dev
```

If `VITE_MAP_STYLE_URL` is set, MapLibre uses that style URL for the self-hosted basemap. If it is missing, the app falls back to OpenStreetMap Standard raster tiles. The basemap selector still shows `Self-hosted`, but choosing it displays a setup message instead of changing the map.

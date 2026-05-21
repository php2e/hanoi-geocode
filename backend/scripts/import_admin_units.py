import argparse
import json
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import MultiPolygon, shape
from shapely.ops import transform
from shapely.wkb import dumps as wkb_dumps

from app.db import get_conn
from app.services.normalize import admin_code_slug

TO_32648 = Transformer.from_crs("EPSG:4326", "EPSG:32648", always_xy=True)


def to_multipolygon(geom):
    if geom.geom_type == "Polygon":
        return MultiPolygon([geom])
    if geom.geom_type == "MultiPolygon":
        return geom
    raise ValueError(f"Unsupported geometry type: {geom.geom_type}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default="../data/hanoi_wards_2026.geojson")
    parser.add_argument("--boundary-version", default="hanoi-2026-v1")
    parser.add_argument("--source", default="data/hanoi_wards_2026.geojson")
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()

    path = Path(args.path).resolve()
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("type") != "FeatureCollection":
        raise SystemExit("Expected a GeoJSON FeatureCollection.")

    rows = []
    slugs: set[str] = set()
    total_area = 0.0
    for idx, feature in enumerate(data.get("features", []), start=1):
        props = feature.get("properties") or {}
        name = props.get("name") or props.get("official_name") or props.get("name:vi")
        if not name:
            raise SystemExit(f"Feature {idx} is missing a name property.")
        geom_4326 = to_multipolygon(shape(feature["geometry"]))
        if not geom_4326.is_valid:
            fixed = geom_4326.buffer(0)
            if not fixed.is_valid:
                raise SystemExit(f"Invalid geometry for {name}; buffer(0) did not repair it.")
            geom_4326 = to_multipolygon(fixed)
        geom_32648 = to_multipolygon(transform(TO_32648.transform, geom_4326))
        area_km2 = geom_32648.area / 1_000_000
        slug = admin_code_slug(name)
        if slug in slugs:
            raise SystemExit(f"Duplicate admin slug after normalization: {slug}")
        slugs.add(slug)
        unit_type = name.split()[0] if " " in name else None
        admin_level = int(props["admin_level"]) if props.get("admin_level") else None
        rows.append((name, slug, unit_type, admin_level, args.source, args.boundary_version, geom_4326, geom_32648, area_km2))
        total_area += area_km2

    with get_conn() as conn:
        if args.replace:
            conn.execute("TRUNCATE admin_grid_intervals, admin_code_params, grid_versions, admin_units RESTART IDENTITY CASCADE")
        for row in rows:
            conn.execute(
                """
                INSERT INTO admin_units
                  (name, slug, unit_type, admin_level, source, boundary_version, geom_4326, geom_32648, area_km2)
                VALUES (%s, %s, %s, %s, %s, %s, ST_GeomFromWKB(%s, 4326), ST_GeomFromWKB(%s, 32648), %s)
                ON CONFLICT (slug) DO UPDATE SET
                  name = EXCLUDED.name,
                  unit_type = EXCLUDED.unit_type,
                  admin_level = EXCLUDED.admin_level,
                  source = EXCLUDED.source,
                  boundary_version = EXCLUDED.boundary_version,
                  geom_4326 = EXCLUDED.geom_4326,
                  geom_32648 = EXCLUDED.geom_32648,
                  area_km2 = EXCLUDED.area_km2
                """,
                (
                    row[0],
                    row[1],
                    row[2],
                    row[3],
                    row[4],
                    row[5],
                    wkb_dumps(row[6]),
                    wkb_dumps(row[7]),
                    row[8],
                ),
            )
        conn.commit()
    print(f"Imported {len(rows)} admin units; total area {total_area:.2f} km2")


if __name__ == "__main__":
    main()

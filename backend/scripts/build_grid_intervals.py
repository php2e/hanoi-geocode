import argparse
import math
from pathlib import Path
import json

from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point, shape
from shapely.ops import transform
from shapely.wkb import loads as wkb_loads

from app.db import get_conn
from app.services.word_mapping import choose_multiplier, choose_offset

TO_32648 = Transformer.from_crs("EPSG:4326", "EPSG:32648", always_xy=True)


def grid_version_name(cell_size: float) -> str:
    size = int(cell_size) if cell_size == int(cell_size) else str(cell_size).replace(".", "_")
    return f"hanoi-2026-grid-{size}m-v1"


def compute_origin(boundary_path: str, cell_size: float) -> tuple[float, float]:
    data = json.loads(Path(boundary_path).resolve().read_text(encoding="utf-8"))
    geom = shape(data["features"][0]["geometry"])
    geom_32648 = transform(TO_32648.transform, geom)
    min_x, min_y, _, _ = geom_32648.bounds
    return math.floor(min_x / cell_size) * cell_size, math.floor(min_y / cell_size) * cell_size


def collect_x_segments(intersection) -> list[tuple[float, float]]:
    segments: list[tuple[float, float]] = []
    if intersection.is_empty:
        return segments
    geoms = getattr(intersection, "geoms", [intersection])
    for geom in geoms:
        if isinstance(geom, LineString):
            xs = [coord[0] for coord in geom.coords]
            if xs:
                segments.append((min(xs), max(xs)))
        elif isinstance(geom, MultiLineString):
            for line in geom.geoms:
                xs = [coord[0] for coord in line.coords]
                if xs:
                    segments.append((min(xs), max(xs)))
        elif geom.geom_type == "GeometryCollection":
            segments.extend(collect_x_segments(geom))
    return segments


def build_intervals_for_polygon(poly, admin_id: int, grid_id: int, origin_x: float, origin_y: float, cell_size: float):
    min_x, min_y, max_x, max_y = poly.bounds
    y_start = math.floor((min_y - origin_y) / cell_size)
    y_end = math.floor((max_y - origin_y) / cell_size)
    line_min_x = min_x - cell_size
    line_max_x = max_x + cell_size
    cumulative = 0
    intervals = []

    for y_index in range(y_start, y_end + 1):
        center_y = origin_y + (y_index + 0.5) * cell_size
        line = LineString([(line_min_x, center_y), (line_max_x, center_y)])
        for seg_min_x, seg_max_x in collect_x_segments(poly.intersection(line)):
            x_start = math.ceil((seg_min_x - origin_x) / cell_size - 0.5)
            x_end = math.floor((seg_max_x - origin_x) / cell_size - 0.5)
            if x_start > x_end:
                continue
            # Boundary-touching rows can produce degenerate line pieces; verify endpoints by center coverage.
            while x_start <= x_end and not poly.covers(Point(origin_x + (x_start + 0.5) * cell_size, center_y)):
                x_start += 1
            while x_start <= x_end and not poly.covers(Point(origin_x + (x_end + 0.5) * cell_size, center_y)):
                x_end -= 1
            if x_start > x_end:
                continue
            count = x_end - x_start + 1
            intervals.append((grid_id, admin_id, y_index, x_start, x_end, count, cumulative, cumulative + count - 1))
            cumulative += count
    return intervals, cumulative


def insert_grid_intervals(conn, intervals) -> None:
    with conn.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO admin_grid_intervals
              (grid_version_id, admin_unit_id, y_index, x_start, x_end, interval_count, cumulative_start, cumulative_end)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            intervals,
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cell-size", type=float, default=3)
    parser.add_argument("--boundary-path", default="../data/hanoi_bound_2026.geojson")
    parser.add_argument("--boundary-version", default="hanoi-2026-v1")
    parser.add_argument("--limit-admin-slug")
    parser.add_argument("--rebuild", action="store_true")
    args = parser.parse_args()

    version = grid_version_name(args.cell_size)
    origin_x, origin_y = compute_origin(args.boundary_path, args.cell_size)

    with get_conn() as conn:
        word_count = conn.execute("SELECT count(*) AS count FROM words WHERE is_active").fetchone()["count"]
        if word_count <= 0:
            raise SystemExit("No active words. Run import_words.py first.")
        pair_capacity = word_count * word_count
        grid = conn.execute("SELECT * FROM grid_versions WHERE version = %s", (version,)).fetchone()
        if grid and args.rebuild:
            conn.execute("DELETE FROM admin_grid_intervals WHERE grid_version_id = %s", (grid["id"],))
            conn.execute("DELETE FROM admin_code_params WHERE grid_version_id = %s", (grid["id"],))
        if not grid:
            grid = conn.execute(
                """
                INSERT INTO grid_versions (version, crs, cell_size_m, origin_x, origin_y, boundary_version, word_count)
                VALUES (%s, 'EPSG:32648', %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (version, args.cell_size, origin_x, origin_y, args.boundary_version, word_count),
            ).fetchone()

        if args.limit_admin_slug:
            admins = conn.execute(
                "SELECT id, name, slug, boundary_version, ST_AsBinary(geom_32648) AS geom FROM admin_units WHERE slug = %s",
                (args.limit_admin_slug,),
            ).fetchall()
        else:
            admins = conn.execute(
                "SELECT id, name, slug, boundary_version, ST_AsBinary(geom_32648) AS geom FROM admin_units ORDER BY id"
            ).fetchall()
        if not admins:
            raise SystemExit("No admin units matched. Run import_admin_units.py first.")

        for admin in admins:
            existing = conn.execute(
                "SELECT count(*) AS count FROM admin_grid_intervals WHERE grid_version_id = %s AND admin_unit_id = %s",
                (grid["id"], admin["id"]),
            ).fetchone()["count"]
            if existing and not args.rebuild:
                print(f"Skipping {admin['slug']}: intervals already exist")
                continue
            conn.execute(
                "DELETE FROM admin_grid_intervals WHERE grid_version_id = %s AND admin_unit_id = %s",
                (grid["id"], admin["id"]),
            )
            geom = wkb_loads(bytes(admin["geom"]))
            print(f"Building intervals for {admin['slug']} ({admin['name']})")
            intervals, cell_count = build_intervals_for_polygon(
                geom, admin["id"], grid["id"], grid["origin_x"], grid["origin_y"], grid["cell_size_m"]
            )
            if cell_count <= 0:
                raise SystemExit(f"No cells assigned for {admin['slug']}")
            if cell_count > pair_capacity:
                raise SystemExit(
                    f"Word pair capacity too small for {admin['slug']}: cell_count={cell_count}, capacity={pair_capacity}"
                )
            insert_grid_intervals(conn, intervals)
            multiplier = choose_multiplier(admin["slug"], grid["version"], admin["boundary_version"], pair_capacity)
            offset_value = choose_offset(admin["slug"], grid["version"], admin["boundary_version"], pair_capacity)
            conn.execute(
                """
                INSERT INTO admin_code_params
                  (admin_unit_id, grid_version_id, word_count, pair_capacity, multiplier, offset_value, cell_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (admin_unit_id) DO UPDATE SET
                  grid_version_id = EXCLUDED.grid_version_id,
                  word_count = EXCLUDED.word_count,
                  pair_capacity = EXCLUDED.pair_capacity,
                  multiplier = EXCLUDED.multiplier,
                  offset_value = EXCLUDED.offset_value,
                  cell_count = EXCLUDED.cell_count
                """,
                (admin["id"], grid["id"], word_count, pair_capacity, multiplier, offset_value, cell_count),
            )
            conn.commit()
            print(f"  rows={len(intervals)} cells={cell_count}")


if __name__ == "__main__":
    main()

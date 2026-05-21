from fastapi import HTTPException

from app.db import get_conn
from app.services.geometry import cell_center_xy, cell_indices, cell_polygon_geojson, lonlat_to_xy, xy_to_lonlat
from app.services.normalize import code_candidates
from app.services.word_mapping import local_to_pair, pair_to_local


def api_error(code: str, message: str, status_code: int = 400) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def encode_point(lat: float, lon: float) -> dict:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise api_error("INVALID_COORDINATE", "Latitude or longitude is outside valid range.")
    with get_conn() as conn:
        admin = conn.execute(
            """
            SELECT id, name, slug, area_km2
            FROM admin_units
            WHERE ST_Covers(geom_4326, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
            ORDER BY area_km2 ASC
            LIMIT 1
            """,
            (lon, lat),
        ).fetchone()
        if not admin:
            raise api_error("OUT_OF_SUPPORTED_AREA", "Point is outside supported Hanoi ward/commune boundaries.", 404)
        grid = latest_grid(conn)
        x, y = lonlat_to_xy(lon, lat)
        x_index, y_index = cell_indices(x, y, grid["origin_x"], grid["origin_y"], grid["cell_size_m"])
        interval = conn.execute(
            """
            SELECT * FROM admin_grid_intervals
            WHERE grid_version_id = %s AND admin_unit_id = %s AND y_index = %s
              AND x_start <= %s AND x_end >= %s
            LIMIT 1
            """,
            (grid["id"], admin["id"], y_index, x_index, x_index),
        ).fetchone()
        if not interval:
            raise api_error("CELL_NOT_ASSIGNED", "The clicked grid cell center is not assigned to this admin unit.", 404)
        params = code_params(conn, admin["id"], grid["id"])
        local_index = interval["cumulative_start"] + (x_index - interval["x_start"])
        _, word1_id, word2_id = local_to_pair(
            local_index, params["word_count"], params["multiplier"], params["offset_value"], params["pair_capacity"]
        )
        w1, w2 = words_by_ids(conn, word1_id, word2_id)
        center_x, center_y = cell_center_xy(x_index, y_index, grid["origin_x"], grid["origin_y"], grid["cell_size_m"])
        center_lon, center_lat = xy_to_lonlat(center_x, center_y)
        code = f"{admin['slug']}.{w1['slug']}.{w2['slug']}"
        return {
            "code": code,
            "display_code": format_display_code(admin["name"], w1["display"], w2["display"]),
            "admin_unit": admin_out(admin),
            "clicked": {"lat": lat, "lon": lon},
            "center": {"lat": center_lat, "lon": center_lon},
            "cell_size_m": grid["cell_size_m"],
            "grid_version": grid["version"],
            "cell_polygon": cell_polygon_geojson(x_index, y_index, grid["origin_x"], grid["origin_y"], grid["cell_size_m"]),
        }


def decode_code(raw_code: str) -> dict:
    candidates = []
    for candidate in code_candidates(raw_code):
        parts = candidate.split(".")
        if len(parts) == 3 and all(parts):
            candidates.append(tuple(parts))
    if not candidates:
        raise api_error("INVALID_CODE_FORMAT", "Enter a code like ba-vi.ao-mua.cay-da.")

    saw_admin = False
    saw_words = False
    with get_conn() as conn:
        for admin_slug, word1_slug, word2_slug in candidates:
            admin = conn.execute("SELECT id, name, slug, area_km2 FROM admin_units WHERE slug = %s", (admin_slug,)).fetchone()
            if not admin:
                continue
            saw_admin = True
            grid = latest_grid(conn)
            params = code_params(conn, admin["id"], grid["id"])
            word_rows = conn.execute(
                "SELECT id, display, slug FROM words WHERE slug = ANY(%s) AND is_active ORDER BY id",
                ([word1_slug, word2_slug],),
            ).fetchall()
            by_slug = {row["slug"]: row for row in word_rows}
            if word1_slug not in by_slug or word2_slug not in by_slug:
                continue
            saw_words = True
            local_index = pair_to_local(
                by_slug[word1_slug]["id"],
                by_slug[word2_slug]["id"],
                params["word_count"],
                params["multiplier"],
                params["offset_value"],
                params["pair_capacity"],
            )
            if local_index >= params["cell_count"]:
                continue
            interval = conn.execute(
                """
                SELECT * FROM admin_grid_intervals
                WHERE grid_version_id = %s AND admin_unit_id = %s
                  AND cumulative_start <= %s AND cumulative_end >= %s
                LIMIT 1
                """,
                (grid["id"], admin["id"], local_index, local_index),
            ).fetchone()
            if not interval:
                continue
            x_index = interval["x_start"] + (local_index - interval["cumulative_start"])
            y_index = interval["y_index"]
            center_x, center_y = cell_center_xy(x_index, y_index, grid["origin_x"], grid["origin_y"], grid["cell_size_m"])
            center_lon, center_lat = xy_to_lonlat(center_x, center_y)
            code = f"{admin['slug']}.{word1_slug}.{word2_slug}"
            return {
                "code": code,
                "display_code": format_display_code(admin["name"], by_slug[word1_slug]["display"], by_slug[word2_slug]["display"]),
                "admin_unit": admin_out(admin),
                "center": {"lat": center_lat, "lon": center_lon},
                "cell_size_m": grid["cell_size_m"],
                "grid_version": grid["version"],
                "cell_polygon": cell_polygon_geojson(x_index, y_index, grid["origin_x"], grid["origin_y"], grid["cell_size_m"]),
            }

    if not saw_admin:
        raise api_error("UNKNOWN_ADMIN_UNIT", "No admin unit matches the code prefix.", 404)
    if not saw_words:
        raise api_error("UNKNOWN_WORD", "One or both words are not in the active word list.", 404)
    raise api_error("CODE_NOT_ASSIGNED", "The code is outside the supported area for this admin unit.", 404)


def latest_grid(conn) -> dict:
    grid = conn.execute("SELECT * FROM grid_versions ORDER BY created_at DESC, id DESC LIMIT 1").fetchone()
    if not grid:
        raise api_error("GRID_NOT_BUILT", "No grid version exists. Run build_grid_intervals.py first.", 503)
    return grid


def code_params(conn, admin_unit_id: int, grid_version_id: int) -> dict:
    params = conn.execute(
        "SELECT * FROM admin_code_params WHERE admin_unit_id = %s AND grid_version_id = %s",
        (admin_unit_id, grid_version_id),
    ).fetchone()
    if not params:
        raise api_error("GRID_NOT_BUILT", "Grid intervals/code params are missing for this admin unit.", 503)
    return params


def words_by_ids(conn, word1_id: int, word2_id: int) -> tuple[dict, dict]:
    rows = conn.execute(
        "SELECT id, display, slug FROM words WHERE id = ANY(%s) AND is_active",
        ([word1_id, word2_id],),
    ).fetchall()
    by_id = {row["id"]: row for row in rows}
    if word1_id not in by_id or word2_id not in by_id:
        raise api_error("UNKNOWN_WORD", "A mapped word id is missing from the active word list.", 500)
    return by_id[word1_id], by_id[word2_id]


def admin_out(row: dict) -> dict:
    return {"id": row["id"], "name": row["name"], "slug": row["slug"], "area_km2": row.get("area_km2")}


def format_display_code(admin_name: str, word1: str, word2: str) -> str:
    return f"{admin_name.strip().upper()}. {word1.strip().lower()}. {word2.strip().lower()}"

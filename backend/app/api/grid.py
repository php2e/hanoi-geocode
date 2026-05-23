import math

from fastapi import APIRouter

from app.services.geocode_core import current_grid_version
from app.services.geometry import lonlat_to_xy, xy_to_lonlat

router = APIRouter(prefix="/v1", tags=["grid"])

MAX_GRID_LINES = 1200
MIN_GRID_ZOOM = 18


@router.get("/grid-version/current")
def current() -> dict:
    return current_grid_version()


@router.get("/grid/viewport")
def viewport_grid(west: float, south: float, east: float, north: float, zoom: float) -> dict:
    if zoom < MIN_GRID_ZOOM:
        return {"visible": False, "reason": "zoom_too_low", "grid": None}

    grid = current_grid_version()
    cell_size_m = grid["cell_size_m"]
    origin_x = grid["origin_x"]
    origin_y = grid["origin_y"]

    corners = [
        lonlat_to_xy(west, south),
        lonlat_to_xy(west, north),
        lonlat_to_xy(east, south),
        lonlat_to_xy(east, north),
    ]
    xs = [point[0] for point in corners]
    ys = [point[1] for point in corners]
    min_x = min(xs)
    max_x = max(xs)
    min_y = min(ys)
    max_y = max(ys)

    x_min_index = math.floor((min_x - origin_x) / cell_size_m) - 1
    x_max_index = math.ceil((max_x - origin_x) / cell_size_m) + 1
    y_min_index = math.floor((min_y - origin_y) / cell_size_m) - 1
    y_max_index = math.ceil((max_y - origin_y) / cell_size_m) + 1

    vertical_count = x_max_index - x_min_index + 1
    horizontal_count = y_max_index - y_min_index + 1
    line_count = vertical_count + horizontal_count
    if line_count > MAX_GRID_LINES:
        return {"visible": False, "reason": "too_many_lines", "line_count": line_count}

    features: list[dict] = []
    for x_index in range(x_min_index, x_max_index + 1):
        x = origin_x + x_index * cell_size_m
        start_lon, start_lat = xy_to_lonlat(x, min_y)
        end_lon, end_lat = xy_to_lonlat(x, max_y)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[start_lon, start_lat], [end_lon, end_lat]]},
                "properties": {"kind": "vertical"},
            }
        )

    for y_index in range(y_min_index, y_max_index + 1):
        y = origin_y + y_index * cell_size_m
        start_lon, start_lat = xy_to_lonlat(min_x, y)
        end_lon, end_lat = xy_to_lonlat(max_x, y)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[start_lon, start_lat], [end_lon, end_lat]]},
                "properties": {"kind": "horizontal"},
            }
        )

    return {
        "visible": True,
        "reason": None,
        "grid_version": grid["version"],
        "cell_size_m": cell_size_m,
        "line_count": line_count,
        "grid": {"type": "FeatureCollection", "features": features},
    }

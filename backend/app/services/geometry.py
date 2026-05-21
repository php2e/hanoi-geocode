import math
from typing import Any

from pyproj import Transformer
from shapely.geometry import Polygon, mapping
from shapely.ops import transform


TO_32648 = Transformer.from_crs("EPSG:4326", "EPSG:32648", always_xy=True)
TO_4326 = Transformer.from_crs("EPSG:32648", "EPSG:4326", always_xy=True)


def lonlat_to_xy(lon: float, lat: float) -> tuple[float, float]:
    return TO_32648.transform(lon, lat)


def xy_to_lonlat(x: float, y: float) -> tuple[float, float]:
    return TO_4326.transform(x, y)


def cell_indices(x: float, y: float, origin_x: float, origin_y: float, cell_size_m: float) -> tuple[int, int]:
    return (
        math.floor((x - origin_x) / cell_size_m),
        math.floor((y - origin_y) / cell_size_m),
    )


def cell_center_xy(x_index: int, y_index: int, origin_x: float, origin_y: float, cell_size_m: float) -> tuple[float, float]:
    return (
        origin_x + (x_index + 0.5) * cell_size_m,
        origin_y + (y_index + 0.5) * cell_size_m,
    )


def cell_polygon_xy(x_index: int, y_index: int, origin_x: float, origin_y: float, cell_size_m: float) -> Polygon:
    min_x = origin_x + x_index * cell_size_m
    min_y = origin_y + y_index * cell_size_m
    max_x = min_x + cell_size_m
    max_y = min_y + cell_size_m
    return Polygon([(min_x, min_y), (max_x, min_y), (max_x, max_y), (min_x, max_y), (min_x, min_y)])


def cell_polygon_geojson(x_index: int, y_index: int, origin_x: float, origin_y: float, cell_size_m: float) -> dict[str, Any]:
    poly = cell_polygon_xy(x_index, y_index, origin_x, origin_y, cell_size_m)
    return mapping(transform(TO_4326.transform, poly))

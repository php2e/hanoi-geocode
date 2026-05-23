from typing import Any

from pydantic import BaseModel


class AdminUnitOut(BaseModel):
    id: int
    name: str
    slug: str
    area_km2: float | None = None


class PointOut(BaseModel):
    lat: float
    lon: float


class CodeResponse(BaseModel):
    code: str
    display_code: str | None = None
    admin_unit: AdminUnitOut
    clicked: PointOut | None = None
    center: PointOut
    cell_size_m: float
    grid_version: str
    x_index: int | None = None
    y_index: int | None = None
    local_index: int | None = None
    word_ids: list[int] | None = None
    cell_polygon: dict[str, Any]


class ErrorResponse(BaseModel):
    code: str
    message: str

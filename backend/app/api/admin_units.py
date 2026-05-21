import json
from pathlib import Path

from fastapi import APIRouter

from app.config import get_settings
from app.db import get_conn

router = APIRouter(prefix="/v1", tags=["admin-units"])


@router.get("/admin-units")
def admin_units() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, slug, area_km2 FROM admin_units ORDER BY name"
        ).fetchall()
    return [dict(row) for row in rows]


@router.get("/boundaries/hanoi")
def hanoi_boundary() -> dict:
    return load_geojson(get_settings().boundary_geojson_path)


@router.get("/boundaries/wards")
def ward_boundaries() -> dict:
    return load_geojson(get_settings().wards_geojson_path)


def load_geojson(path: str) -> dict:
    with Path(path).resolve().open(encoding="utf-8") as f:
        return json.load(f)

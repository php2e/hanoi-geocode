from fastapi import APIRouter

from app.services.geocode_core import encode_point

router = APIRouter(prefix="/v1", tags=["encode"])


@router.get("/encode")
def encode(lat: float, lon: float) -> dict:
    return encode_point(lat, lon)

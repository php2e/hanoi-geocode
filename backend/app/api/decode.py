from fastapi import APIRouter

from app.services.geocode_core import decode_code

router = APIRouter(prefix="/v1", tags=["decode"])


@router.get("/decode")
def decode(code: str) -> dict:
    return decode_code(code)

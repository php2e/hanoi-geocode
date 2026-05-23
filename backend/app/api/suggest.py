from fastapi import APIRouter

from app.services.suggestions import suggest_code

router = APIRouter(prefix="/v1", tags=["suggest"])


@router.get("/suggest")
def suggest(code: str) -> dict:
    return {"suggestions": suggest_code(code)}

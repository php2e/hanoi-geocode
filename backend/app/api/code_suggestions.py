from fastapi import APIRouter

from app.services.suggestions import code_suggestions

router = APIRouter(prefix="/v1", tags=["code-suggestions"])


@router.get("/code-suggestions")
def suggest_codes(q: str, limit: int = 5) -> dict:
    return code_suggestions(q, limit=min(max(limit, 1), 5))

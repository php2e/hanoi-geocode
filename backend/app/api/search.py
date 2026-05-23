from fastapi import APIRouter

from app.services.search import search

router = APIRouter(prefix="/v1", tags=["search"])


@router.get("/search")
def unified_search(q: str, limit: int = 8) -> dict:
    return search(q, limit=min(max(limit, 1), 12))

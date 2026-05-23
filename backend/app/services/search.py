from dataclasses import dataclass
import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException

from app.db import get_conn
from app.services.geocode_core import encode_point
from app.services.normalize import admin_code_slug, normalize_code
from app.services.suggestions import code_suggestions


COORD_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$")
HANOI_VIEWBOX = "105.25,21.45,106.10,20.55"


@dataclass(frozen=True)
class SearchProviderResult:
    id: str
    title: str
    subtitle: str
    lat: float
    lon: float
    confidence: str = "medium"
    source: str = "nominatim"


class SearchProvider:
    group_type = ""
    title = ""

    def search(self, query: str, limit: int = 8) -> list[dict]:
        raise NotImplementedError


class CodeSearchProvider(SearchProvider):
    group_type = "codes"
    title = "Codes"

    def search(self, query: str, limit: int = 8) -> list[dict]:
        return [code_result_to_search_result(result) for result in code_suggestions(query, limit=min(limit, 5))["results"]]


class CoordinateSearchProvider(SearchProvider):
    group_type = "coordinates"
    title = "Coordinates"

    def search(self, query: str, limit: int = 8) -> list[dict]:
        point = parse_coordinates(query)
        if not point:
            return []
        lat, lon = point
        try:
            encoded = encode_point(lat, lon)
        except HTTPException as exc:
            if exc.detail.get("code") != "OUT_OF_SUPPORTED_AREA":
                return []
            return [
                {
                    "id": f"coordinate:{lat:.7f},{lon:.7f}",
                    "type": "coordinate",
                    "title": f"{lat:.6f}, {lon:.6f}",
                    "subtitle": "Coordinates outside supported Hanoi area",
                    "code": None,
                    "display_code": None,
                    "lat": lat,
                    "lon": lon,
                    "admin_unit": None,
                    "confidence": "low",
                    "source": "coordinate",
                }
            ][:limit]
        return [
            {
                "id": f"coordinate:{lat:.7f},{lon:.7f}",
                "type": "coordinate",
                "title": f"{lat:.6f}, {lon:.6f}",
                "subtitle": f"Coordinates in {encoded['admin_unit']['name']}",
                "code": encoded["code"],
                "display_code": encoded.get("display_code"),
                "lat": lat,
                "lon": lon,
                "admin_unit": admin_summary(encoded["admin_unit"]),
                "confidence": "high",
                "source": "coordinate",
            }
        ][:limit]


class AdminUnitSearchProvider(SearchProvider):
    group_type = "admin_units"
    title = "Admin units"

    def search(self, query: str, limit: int = 8) -> list[dict]:
        normalized = normalize_code(query)
        slug = admin_code_slug(query)
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT
                  id,
                  name,
                  slug,
                  ST_Y(ST_PointOnSurface(geom_4326)) AS lat,
                  ST_X(ST_PointOnSurface(geom_4326)) AS lon
                FROM admin_units
                WHERE slug ILIKE %s OR slug ILIKE %s OR lower(name) LIKE lower(%s)
                ORDER BY
                  CASE WHEN slug = %s THEN 0 WHEN slug ILIKE %s THEN 1 ELSE 2 END,
                  name
                LIMIT %s
                """,
                (f"{slug}%", f"%{slug}%", f"%{query.strip()}%", slug, f"{normalized}%", limit),
            ).fetchall()
        return [
            {
                "id": f"admin_unit:{row['slug']}",
                "type": "admin_unit",
                "title": row["name"],
                "subtitle": "Hà Nội",
                "code": None,
                "display_code": None,
                "lat": row["lat"],
                "lon": row["lon"],
                "admin_unit": {"name": row["name"], "slug": row["slug"]},
                "confidence": "high" if row["slug"] == slug else "medium",
                "source": "admin_units",
            }
            for row in rows
        ]


class PlaceSearchProvider(SearchProvider):
    group_type = "places"
    title = "Places"

    def search(self, query: str, limit: int = 8) -> list[dict]:
        return [place_provider_result_to_search_result(result) for result in self.provider_search(query, limit)]

    def provider_search(self, query: str, limit: int = 8) -> list[SearchProviderResult]:
        raise NotImplementedError


class NominatimSearchProvider(PlaceSearchProvider):
    endpoint = "https://nominatim.openstreetmap.org/search"

    def provider_search(self, query: str, limit: int = 8) -> list[SearchProviderResult]:
        params = {
            "q": query,
            "format": "jsonv2",
            "addressdetails": "1",
            "limit": str(limit),
            "countrycodes": "vn",
            "viewbox": HANOI_VIEWBOX,
            "bounded": "1",
            "accept-language": "vi",
        }
        request = Request(
            f"{self.endpoint}?{urlencode(params)}",
            headers={"User-Agent": "hanoi-geocode-demo/0.1"},
        )
        with urlopen(request, timeout=3) as response:
            payload = json.loads(response.read().decode("utf-8"))

        results = []
        seen = set()
        for item in payload:
            try:
                lat = float(item["lat"])
                lon = float(item["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            title = item.get("name") or first_display_part(item.get("display_name", query))
            subtitle = item.get("display_name", "")
            dedupe_key = normalize_code(f"{title}.{subtitle[:80]}")
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            results.append(
                SearchProviderResult(
                    id=f"nominatim:{item.get('place_id', len(results))}",
                    title=title,
                    subtitle=subtitle,
                    lat=lat,
                    lon=lon,
                    confidence="medium",
                    source="nominatim",
                )
            )
            if len(results) >= limit:
                break
        return results


def search(query: str, place_provider: PlaceSearchProvider | None = None, limit: int = 8) -> dict:
    cleaned = query.strip()
    if not cleaned:
        return {"query": query, "groups": [], "results": []}

    providers: list[SearchProvider]
    if parse_coordinates(cleaned):
        providers = [CoordinateSearchProvider()]
    elif looks_like_code(cleaned):
        providers = [CodeSearchProvider()]
    else:
        providers = [place_provider or NominatimSearchProvider(), AdminUnitSearchProvider()]

    groups = []
    flat_results = []
    seen = set()
    for provider in providers:
        try:
            provider_results = dedupe(provider.search(cleaned, limit=limit), seen)
        except Exception:
            provider_results = []
        if provider_results:
            groups.append({"type": provider.group_type, "title": provider.title, "results": provider_results})
            flat_results.extend(provider_results)
    return {"query": query, "groups": groups, "results": flat_results}


def looks_like_code(query: str) -> bool:
    normalized = normalize_code(query.lstrip("/"))
    if "." in normalized or "/" in query:
        return True
    return len([token for token in normalized.split("-") if token]) >= 5


def parse_coordinates(query: str) -> tuple[float, float] | None:
    match = COORD_RE.match(query)
    if not match:
        return None
    first = float(match.group(1))
    second = float(match.group(2))
    if -90 <= first <= 90 and -180 <= second <= 180:
        return first, second
    return None


def code_result_to_search_result(result: dict) -> dict:
    return {
        "id": f"code:{result['code']}",
        "type": "code",
        "title": result["code"],
        "subtitle": result["subtitle"],
        "code": result["code"],
        "display_code": result["display_code"],
        "lat": result["center"]["lat"],
        "lon": result["center"]["lon"],
        "admin_unit": result["admin_unit"],
        "confidence": result["confidence"],
        "source": "code",
        "match_reason": result.get("match_reason"),
    }


def place_provider_result_to_search_result(result: SearchProviderResult) -> dict:
    return {
        "id": result.id,
        "type": "place",
        "title": result.title,
        "subtitle": result.subtitle,
        "code": None,
        "display_code": None,
        "lat": result.lat,
        "lon": result.lon,
        "admin_unit": None,
        "confidence": result.confidence,
        "source": result.source,
    }


def dedupe(results: list[dict], seen: set[str]) -> list[dict]:
    deduped = []
    for result in results:
        key = result["id"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(result)
    return deduped


def admin_summary(admin_unit: dict) -> dict:
    return {"name": admin_unit["name"], "slug": admin_unit["slug"]}


def first_display_part(display_name: str) -> str:
    return display_name.split(",", 1)[0].strip()

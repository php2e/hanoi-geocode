from contextlib import contextmanager

from app.services import search
from app.services.search import PlaceSearchProvider, SearchProviderResult


class FakePlaceProvider(PlaceSearchProvider):
    def provider_search(self, query: str, limit: int = 8) -> list[SearchProviderResult]:
        return [
            SearchProviderResult(
                id="place:ho-guom",
                title="Hồ Gươm",
                subtitle="Hoàn Kiếm, Hà Nội, Việt Nam",
                lat=21.0285,
                lon=105.8542,
                confidence="medium",
                source="nominatim",
            )
        ][:limit]


class FailingPlaceProvider(PlaceSearchProvider):
    def provider_search(self, query: str, limit: int = 8) -> list[SearchProviderResult]:
        raise RuntimeError("provider down")


class FakeConn:
    def execute(self, *_args, **_kwargs):
        return self

    def fetchall(self):
        return [{"id": 1, "name": "Xã Ba Vì", "slug": "ba-vi", "lat": 21.1, "lon": 105.4}]


@contextmanager
def fake_get_conn():
    yield FakeConn()


def test_search_returns_grouped_exact_code(monkeypatch):
    monkeypatch.setattr(search, "code_suggestions", lambda query, limit=8: {"results": [code_suggestion()]})
    response = search.search("ba-vi.ao-mua.cay-da", place_provider=FakePlaceProvider())
    assert response["groups"][0]["type"] == "codes"
    assert response["groups"][0]["results"][0]["code"] == "ba-vi.ao-mua.cay-da"
    assert response["groups"][0]["results"][0]["title"] == "Ba Vì.áo mưa.cây đa"
    assert response["groups"][0]["results"][0]["subtitle"] == "Xã Ba Vì, Hà Nội"


def test_search_detects_space_separated_code(monkeypatch):
    monkeypatch.setattr(search, "code_suggestions", lambda query, limit=8: {"results": [code_suggestion()]})
    response = search.search("ba vi ao mua cay da", place_provider=FakePlaceProvider())
    assert response["groups"][0]["type"] == "codes"


def test_search_returns_coordinate_group(monkeypatch):
    monkeypatch.setattr(search, "encode_point", lambda lat, lon: {"code": "ba-vi.ao-mua.cay-da", "display_code": "Ba Vì.áo mưa.cây đa", "admin_unit": {"name": "Xã Ba Vì", "slug": "ba-vi"}})
    response = search.search("21.0285, 105.8542", place_provider=FakePlaceProvider())
    assert response["groups"][0]["type"] == "coordinates"
    assert response["groups"][0]["results"][0]["code"] == "ba-vi.ao-mua.cay-da"


def test_search_returns_admin_units_and_places(monkeypatch):
    monkeypatch.setattr(search, "get_conn", fake_get_conn)
    response = search.search("Hồ Gươm", place_provider=FakePlaceProvider())
    group_types = [group["type"] for group in response["groups"]]
    assert group_types[0] == "places"
    assert "admin_units" in group_types
    assert "places" in group_types


def test_provider_failure_does_not_break_admin_search(monkeypatch):
    monkeypatch.setattr(search, "get_conn", fake_get_conn)
    response = search.search("Ba Vì", place_provider=FailingPlaceProvider())
    assert response["groups"][0]["type"] == "admin_units"


def code_suggestion():
    return {
        "code": "ba-vi.ao-mua.cay-da",
        "display_code": "Ba Vì.áo mưa.cây đa",
        "subtitle": "Xã Ba Vì, Hà Nội",
        "admin_unit": {"name": "Xã Ba Vì", "slug": "ba-vi"},
        "center": {"lat": 21.0, "lon": 105.0},
        "confidence": "high",
        "match_reason": "exact match",
    }

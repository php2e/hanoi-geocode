from contextlib import contextmanager

import pytest

from app.services import geocode_core


class FakeDecodeConn:
    def __init__(self, words=None, interval=None):
        self.words = words or []
        self.interval = interval
        self.last_query = ""

    def execute(self, query, *_args, **_kwargs):
        self.last_query = query
        return self

    def fetchone(self):
        if "FROM admin_units" in self.last_query:
            return {"id": 1, "name": "Ba Vì", "slug": "ba-vi", "area_km2": 1.0}
        if "FROM grid_versions" in self.last_query:
            return {"id": 1, "version": "test", "origin_x": 0, "origin_y": 0, "cell_size_m": 3}
        if "FROM admin_code_params" in self.last_query:
            return {"word_count": 10, "multiplier": 1, "offset_value": 0, "pair_capacity": 100, "cell_count": 1}
        if "FROM admin_grid_intervals" in self.last_query:
            return self.interval
        return None

    def fetchall(self):
        if "FROM words" in self.last_query:
            return self.words
        return []


class MissingAdminConn(FakeDecodeConn):
    def fetchone(self):
        if "FROM admin_units" in self.last_query:
            return None
        return super().fetchone()


@contextmanager
def fake_conn(conn):
    yield conn


def test_decode_invalid_format_returns_structured_error():
    with pytest.raises(Exception) as exc:
        geocode_core.decode_code("too.many.parts.here")
    assert exc.value.detail["code"] == "INVALID_CODE_FORMAT"
    assert exc.value.detail["message"]


def test_decode_unknown_admin_unit_returns_structured_error(monkeypatch):
    monkeypatch.setattr(geocode_core, "get_conn", lambda: fake_conn(MissingAdminConn()))
    with pytest.raises(Exception) as exc:
        geocode_core.decode_code("not-real.ao-mua.cay-da")
    assert exc.value.detail["code"] == "UNKNOWN_ADMIN_UNIT"
    assert exc.value.detail["message"]


def test_decode_unknown_word_returns_structured_error(monkeypatch):
    monkeypatch.setattr(geocode_core, "get_conn", lambda: fake_conn(FakeDecodeConn()))
    with pytest.raises(Exception) as exc:
        geocode_core.decode_code("ba-vi.ao-mua.cay-da")
    assert exc.value.detail["code"] == "UNKNOWN_WORD"
    assert exc.value.detail["message"]


def test_decode_code_not_assigned_returns_structured_error(monkeypatch):
    words = [{"id": 1, "display": "Áo mưa", "slug": "ao-mua"}, {"id": 2, "display": "Cây đa", "slug": "cay-da"}]
    monkeypatch.setattr(geocode_core, "get_conn", lambda: fake_conn(FakeDecodeConn(words=words)))
    monkeypatch.setattr(geocode_core, "pair_to_local", lambda *_args: 2)
    with pytest.raises(Exception) as exc:
        geocode_core.decode_code("ba-vi.ao-mua.cay-da")
    assert exc.value.detail["code"] == "CODE_NOT_ASSIGNED"
    assert exc.value.detail["message"]

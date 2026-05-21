from contextlib import contextmanager

import pytest

from app.services import geocode_core


class FakeConn:
    def execute(self, *_args, **_kwargs):
        return self

    def fetchone(self):
        return None


@contextmanager
def fake_get_conn():
    yield FakeConn()


def test_encode_outside_hanoi_returns_supported_area_error(monkeypatch):
    monkeypatch.setattr(geocode_core, "get_conn", fake_get_conn)
    with pytest.raises(Exception) as exc:
        geocode_core.encode_point(10.0, 10.0)
    assert exc.value.detail["code"] == "OUT_OF_SUPPORTED_AREA"

from contextlib import contextmanager

from app.services import geocode_core


class FakeGridConn:
    def execute(self, *_args, **_kwargs):
        return self

    def fetchone(self):
        return {
            "version": "hanoi-2026-grid-3m-v1",
            "crs": "EPSG:32648",
            "cell_size_m": 3,
            "origin_x": 500000,
            "origin_y": 2300000,
        }


@contextmanager
def fake_get_conn():
    yield FakeGridConn()


def test_current_grid_version_metadata(monkeypatch):
    monkeypatch.setattr(geocode_core, "get_conn", fake_get_conn)
    assert geocode_core.current_grid_version() == {
        "version": "hanoi-2026-grid-3m-v1",
        "crs": "EPSG:32648",
        "cell_size_m": 3,
        "origin_x": 500000,
        "origin_y": 2300000,
    }

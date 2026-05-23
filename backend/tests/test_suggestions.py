from contextlib import contextmanager

from fastapi import HTTPException

from app.services import suggestions


class FakeConn:
    def __init__(self):
        self.last_query = ""

    def execute(self, query, *_args, **_kwargs):
        self.last_query = query
        return self

    def fetchall(self):
        if "FROM admin_units" in self.last_query:
            return [
                {"name": "Xã Ba Vì", "slug": "ba-vi"},
                {"name": "Phường Văn Miếu - Quốc Tử Giám", "slug": "van-mieu-quoc-tu-giam"},
                {"name": "Phường Hoàn Kiếm", "slug": "hoan-kiem"},
            ]
        if "FROM words" in self.last_query:
            return [
                {"display": "Áo mưa", "slug": "ao-mua"},
                {"display": "Áo mùa", "slug": "ao-mua-alt"},
                {"display": "Cây đa", "slug": "cay-da"},
                {"display": "Cây đá", "slug": "cay-da-alt"},
                {"display": "Mây xanh", "slug": "may-xanh"},
                {"display": "Góc nhỏ", "slug": "goc-nho"},
            ]
        return []


@contextmanager
def fake_get_conn():
    yield FakeConn()


def fake_decoded(code: str):
    valid = {
        "ba-vi.ao-mua.cay-da",
        "ba-vi.ao-mua.cay-da-alt",
        "ba-vi.ao-mua-alt.cay-da",
        "van-mieu-quoc-tu-giam.may-xanh.goc-nho",
        "hoan-kiem.may-xanh.goc-nho",
    }
    if code not in valid:
        raise HTTPException(status_code=404, detail={"code": "CODE_NOT_ASSIGNED"})
    admin_slug = code.split(".")[0]
    admin_name = {
        "ba-vi": "Xã Ba Vì",
        "van-mieu-quoc-tu-giam": "Phường Văn Miếu - Quốc Tử Giám",
        "hoan-kiem": "Phường Hoàn Kiếm",
    }[admin_slug]
    return {
        "code": code,
        "display_code": code,
        "admin_unit": {"name": admin_name, "slug": admin_slug},
        "center": {"lat": 21.0, "lon": 105.0},
    }


def setup_suggestions(monkeypatch):
    monkeypatch.setattr(suggestions, "get_conn", fake_get_conn)
    monkeypatch.setattr(suggestions, "decode_code", fake_decoded)


def test_code_normalization_with_leading_slashes(monkeypatch):
    setup_suggestions(monkeypatch)
    result = suggestions.code_suggestions("///Ba Vì.Áo mưa.Cây đa")["results"]
    assert result[0]["code"] == "ba-vi.ao-mua.cay-da"


def test_code_normalization_with_spaces(monkeypatch):
    setup_suggestions(monkeypatch)
    result = suggestions.code_suggestions("ba vi ao mua cay da")["results"]
    assert result[0]["code"] == "ba-vi.ao-mua.cay-da"


def test_code_normalization_with_slashes(monkeypatch):
    setup_suggestions(monkeypatch)
    result = suggestions.code_suggestions("ba-vi/ao-mua/cay-da")["results"]
    assert result[0]["code"] == "ba-vi.ao-mua.cay-da"


def test_fuzzy_code_suggestion_one_character_typo(monkeypatch):
    setup_suggestions(monkeypatch)
    result = suggestions.code_suggestions("ba-vi.ao-mua.cay-daa")["results"]
    assert result[0]["code"] == "ba-vi.ao-mua.cay-da"
    assert result[0]["match_reason"] == "word2 typo"
    assert result[0]["confidence"] in {"high", "medium"}


def test_unknown_close_word_returns_suggestions(monkeypatch):
    setup_suggestions(monkeypatch)
    result = suggestions.code_suggestions("ba-vi.ao-mua.cay-ba")["results"]
    assert result
    assert all(item["code"].startswith("ba-vi.") for item in result)


def test_no_random_low_quality_suggestions(monkeypatch):
    setup_suggestions(monkeypatch)
    assert suggestions.code_suggestions("zzzz.zzzz.zzzz")["results"] == []


def test_multi_word_admin_slug_parsing(monkeypatch):
    setup_suggestions(monkeypatch)
    result = suggestions.code_suggestions("van mieu quoc tu giam may xanh goc nho")["results"]
    assert result[0]["code"] == "van-mieu-quoc-tu-giam.may-xanh.goc-nho"


def test_hoan_kiem_space_code_parsing(monkeypatch):
    setup_suggestions(monkeypatch)
    result = suggestions.code_suggestions("hoan kiem may xanh goc nho")["results"]
    assert result[0]["code"] == "hoan-kiem.may-xanh.goc-nho"


def test_levenshtein_distance():
    assert suggestions.levenshtein("cay-ba", "cay-da") == 1
    assert suggestions.levenshtein("ao-mua", "ao-mua") == 0

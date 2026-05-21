from app.services.geocode_core import format_display_code
from app.services.normalize import code_candidates, normalize_code, slugify


def test_vietnamese_normalization():
    assert slugify("Ba Vì") == "ba-vi"
    assert slugify("Áo mưa") == "ao-mua"


def test_normalize_code_with_vietnamese_accents():
    assert normalize_code("Ba Vì. Áo mưa. Cây đa") == "ba-vi.ao-mua.cay-da"


def test_normalize_code_with_extra_spaces():
    assert normalize_code("  ba-vi  .   ao-mua  .  cay-da  ") == "ba-vi.ao-mua.cay-da"


def test_normalize_code_with_mixed_separators():
    assert normalize_code("ba-vi / ao-mua / cay-da") == "ba-vi.ao-mua.cay-da"


def test_normalize_code_with_uppercase_and_lowercase():
    assert normalize_code("BA-VI.Ao-Mua.CAY-DA") == "ba-vi.ao-mua.cay-da"


def test_code_candidates_for_space_separated_code():
    assert "ba-vi.ao-mua.cay-da" in code_candidates("ba vi ao mua cay da")


def test_display_code_is_vietnamese_readable():
    assert format_display_code("Phường Phúc Lợi", "Tranh Hùng", "Tạ Ma") == "PHƯỜNG PHÚC LỢI. tranh hùng. tạ ma"

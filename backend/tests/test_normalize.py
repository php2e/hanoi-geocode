from app.services.normalize import slugify


def test_vietnamese_normalization():
    assert slugify("Ba Vì") == "ba-vi"
    assert slugify("Áo mưa") == "ao-mua"

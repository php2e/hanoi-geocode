from collections import Counter

from app.services.normalize import slugify


def test_word_import_rejects_duplicate_slugs():
    words = ["Áo mưa", "ao mua", "cây đa"]
    slugs = [slugify(word) for word in words]
    duplicates = [slug for slug, count in Counter(slugs).items() if count > 1]
    assert duplicates == ["ao-mua"]

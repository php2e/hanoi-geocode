from collections import Counter

from scripts.import_words import read_word_source, validate_words
from app.services.normalize import slugify


def test_word_import_rejects_duplicate_slugs():
    words = ["Áo mưa", "ao mua", "cây đa"]
    slugs = [slugify(word) for word in words]
    duplicates = [slug for slug, count in Counter(slugs).items() if count > 1]
    assert duplicates == ["ao-mua"]


def test_read_word_source_csv_auto_detects_word_column(tmp_path):
    path = tmp_path / "words.csv"
    path.write_text("word,score\nxanh biếc,10\nquốc ca,9\n", encoding="utf-8")

    assert read_word_source(path) == ["xanh biếc", "quốc ca"]


def test_read_word_source_csv_uses_explicit_column(tmp_path):
    path = tmp_path / "words.csv"
    path.write_text("word,normalized_word\nXANH BIẾC,xanh biếc\nQUỐC CA,quốc ca\n", encoding="utf-8")

    assert read_word_source(path, "normalized_word") == ["xanh biếc", "quốc ca"]


def test_word_source_can_be_limited_to_top_rows(tmp_path):
    path = tmp_path / "words.csv"
    path.write_text("word,score\nxanh biếc,10\nquốc ca,9\nan lành,8\n", encoding="utf-8")

    assert read_word_source(path)[:2] == ["xanh biếc", "quốc ca"]


def test_validate_words_can_keep_first_duplicate_slug():
    candidates, rejected, duplicate_slugs = validate_words(["quân ca", "quản ca", "an lành"], "keep-first")

    assert candidates == [("quân ca", "quan-ca"), ("an lành", "an-lanh")]
    assert rejected == [("quản ca", "duplicate slug kept earlier: quan-ca")]
    assert duplicate_slugs == ["quan-ca"]

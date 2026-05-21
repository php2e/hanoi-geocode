import re
import unicodedata


SEPARATOR_RE = re.compile(r"[\s_.]+")
HYPHEN_RE = re.compile(r"-+")
VALID_SLUG_RE = re.compile(r"^[a-z-]+$")


def strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn").replace("đ", "d").replace("Đ", "D")


def slugify(value: str) -> str:
    value = strip_accents(value.strip().lower())
    value = SEPARATOR_RE.sub("-", value)
    value = re.sub(r"[^a-z-]+", "-", value)
    value = HYPHEN_RE.sub("-", value).strip("-")
    return value


def normalize_code(value: str) -> str:
    value = strip_accents(value.strip().lower())
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"-*\.-*", ".", value)
    value = HYPHEN_RE.sub("-", value)
    value = re.sub(r"\.+", ".", value).strip(".-")
    return value


def is_valid_word_slug(slug: str) -> bool:
    return bool(slug) and len(slug) >= 2 and bool(VALID_SLUG_RE.fullmatch(slug))


def admin_code_slug(name: str) -> str:
    slug = slugify(name)
    for prefix in ("phuong-", "xa-", "thi-tran-"):
        if slug.startswith(prefix):
            return slug[len(prefix) :]
    return slug

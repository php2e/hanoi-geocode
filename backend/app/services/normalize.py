import re
import unicodedata


SEPARATOR_RE = re.compile(r"[\s_.]+")
HYPHEN_RE = re.compile(r"-+")
VALID_SLUG_RE = re.compile(r"^[a-z-]+$")
EXPLICIT_PART_SEPARATOR_RE = re.compile(r"\s*[/|;,.]+\s*")


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
    value = EXPLICIT_PART_SEPARATOR_RE.sub(".", value)
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"-*\.-*", ".", value)
    value = HYPHEN_RE.sub("-", value)
    value = re.sub(r"\.+", ".", value).strip(".-")
    return value


def code_candidates(value: str) -> list[str]:
    normalized = normalize_code(value)
    if not normalized:
        return []
    if "." in normalized:
        return [normalized]

    tokens = [token for token in normalized.split("-") if token]
    candidates: list[str] = []
    for admin_end in range(1, len(tokens) - 1):
        for word1_end in range(admin_end + 1, len(tokens)):
            candidate = ".".join(
                (
                    "-".join(tokens[:admin_end]),
                    "-".join(tokens[admin_end:word1_end]),
                    "-".join(tokens[word1_end:]),
                )
            )
            candidates.append(candidate)
    return candidates or [normalized]


def is_valid_word_slug(slug: str) -> bool:
    return bool(slug) and len(slug) >= 2 and bool(VALID_SLUG_RE.fullmatch(slug))


def admin_code_slug(name: str) -> str:
    slug = slugify(name)
    for prefix in ("phuong-", "xa-", "thi-tran-"):
        if slug.startswith(prefix):
            return slug[len(prefix) :]
    return slug

from dataclasses import dataclass

from fastapi import HTTPException

from app.db import get_conn
from app.services.geocode_core import decode_code
from app.services.normalize import admin_code_slug, code_candidates, normalize_code, slugify


@dataclass(frozen=True)
class CatalogItem:
    slug: str
    display: str
    aliases: tuple[str, ...]


@dataclass(frozen=True)
class Match:
    item: CatalogItem
    score: int
    reason: str


def code_suggestions(raw_code: str, limit: int = 5) -> dict:
    normalized_query = normalize_code(raw_code.lstrip("/"))
    with get_conn() as conn:
        admins = [
            CatalogItem(
                slug=row["slug"],
                display=row["name"],
                aliases=(row["slug"], admin_code_slug(row["name"]), slugify(row["name"])),
            )
            for row in conn.execute("SELECT name, slug FROM admin_units ORDER BY slug").fetchall()
        ]
        words = [
            CatalogItem(
                slug=row["slug"],
                display=row["display"],
                aliases=(row["slug"], slugify(row["display"])),
            )
            for row in conn.execute("SELECT display, slug FROM words WHERE is_active ORDER BY slug").fetchall()
        ]

    parsed = parse_code_input(raw_code, admins)
    suggestions: dict[str, dict] = {}
    for admin_part, word1_part, word2_part in parsed[:40]:
        admin_matches = fuzzy_matches(admin_part, admins, limit=4, max_distance=3)
        word1_matches = fuzzy_matches(word1_part, words, limit=5, max_distance=2)
        word2_matches = fuzzy_matches(word2_part, words, limit=5, max_distance=2)
        for admin_match in admin_matches:
            for word1_match in word1_matches:
                for word2_match in word2_matches:
                    code = f"{admin_match.item.slug}.{word1_match.item.slug}.{word2_match.item.slug}"
                    if code in suggestions:
                        continue
                    score = admin_match.score + word1_match.score + word2_match.score
                    if score > 8:
                        continue
                    try:
                        decoded = decode_code(code)
                    except HTTPException:
                        continue
                    suggestions[code] = code_suggestion_result(
                        decoded,
                        confidence_for(score, (admin_match, word1_match, word2_match)),
                        match_reason((admin_match, word1_match, word2_match)),
                        score,
                    )

    ranked = sorted(suggestions.values(), key=lambda item: item["_rank"])
    return {
        "query": raw_code,
        "normalized_query": normalized_query,
        "results": [{key: value for key, value in item.items() if key != "_rank"} for item in ranked[:limit]],
    }


def suggest_code(raw_code: str, limit: int = 5) -> list[dict]:
    """Compatibility wrapper for /v1/suggest."""
    return [
        {
            "suggested_code": result["code"],
            "display_code": result.get("display_code"),
            "reason": result["match_reason"],
            "confidence": result["confidence"],
        }
        for result in code_suggestions(raw_code, limit=limit)["results"]
    ]


def parse_code_input(raw_code: str, admins: list[CatalogItem]) -> list[tuple[str, str, str]]:
    normalized = normalize_code(raw_code.lstrip("/"))
    if not normalized:
        return []

    dotted = [candidate for candidate in code_candidates(normalized) if len(candidate.split(".")) == 3]
    if "." in normalized or "/" in raw_code:
        return [tuple(candidate.split(".")) for candidate in dotted]

    tokens = [token for token in normalized.split("-") if token]
    if len(tokens) < 3:
        return []

    parsed: list[tuple[str, str, str]] = []
    admin_token_options = admin_prefix_lengths(tokens, admins)
    if not admin_token_options:
        admin_token_options = list(range(1, len(tokens) - 1))

    for admin_end in admin_token_options:
        remaining = tokens[admin_end:]
        for word1_end in range(1, len(remaining)):
            parsed.append(("-".join(tokens[:admin_end]), "-".join(remaining[:word1_end]), "-".join(remaining[word1_end:])))
    return parsed


def admin_prefix_lengths(tokens: list[str], admins: list[CatalogItem]) -> list[int]:
    lengths = []
    for item in admins:
        admin_tokens = item.slug.split("-")
        if tokens[: len(admin_tokens)] == admin_tokens:
            lengths.append(len(admin_tokens))
    return sorted(set(lengths), reverse=True)


def fuzzy_matches(value: str, choices: list[CatalogItem], limit: int, max_distance: int) -> list[Match]:
    matches = []
    for item in choices:
        alias_scores = [weighted_alias_score(value, alias, index) for index, alias in enumerate(item.aliases)]
        best_score, reason = min(alias_scores, key=lambda pair: pair[0])
        if best_score <= max_distance * 2:
            matches.append(Match(item=item, score=best_score, reason=reason))
    return sorted(matches, key=lambda match: (match.score, match.item.slug))[:limit]


def weighted_alias_score(value: str, alias: str, index: int) -> tuple[int, str]:
    score, reason = alias_score(value, alias)
    if index > 0 and score == 0:
        score = 1
    return score, reason


def alias_score(value: str, alias: str) -> tuple[int, str]:
    if value == alias:
        return 0, "exact"
    if alias.startswith(value):
        return 1, "prefix"
    distance = levenshtein(value, alias)
    return distance * 2, "typo"


def code_suggestion_result(decoded: dict, confidence: str, reason: str, score: int) -> dict:
    admin = decoded["admin_unit"]
    return {
        "code": decoded["code"],
        "display_code": decoded.get("display_code") or decoded["code"],
        "subtitle": f"{admin['name']}, Hà Nội",
        "admin_unit": {"name": admin["name"], "slug": admin["slug"]},
        "center": decoded["center"],
        "confidence": confidence,
        "match_reason": reason,
        "_rank": (score, decoded["code"]),
    }


def match_reason(matches: tuple[Match, Match, Match]) -> str:
    labels = ("admin", "word1", "word2")
    changed = [(label, match) for label, match in zip(labels, matches) if match.score > 0]
    if not changed:
        return "exact"
    if len(changed) == 1:
        label, match = changed[0]
        if match.reason == "prefix":
            return "prefix match"
        return f"{label} typo"
    if any(match.reason == "prefix" for _, match in changed):
        return "prefix match"
    return "multiple typos"


def confidence_for(score: int, matches: tuple[Match, Match, Match]) -> str:
    if score <= 1:
        return "high"
    if score <= 4 and all(match.score <= 4 for match in matches):
        return "medium"
    return "low"


def levenshtein(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, start=1):
        current = [i]
        for j, right_char in enumerate(right, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (0 if left_char == right_char else 1),
                )
            )
        previous = current
    return previous[-1]

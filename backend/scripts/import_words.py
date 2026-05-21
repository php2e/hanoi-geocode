import argparse
from collections import Counter
from pathlib import Path

from app.db import get_conn
from app.services.normalize import is_valid_word_slug, slugify


def levenshtein_leq_one(a: str, b: str) -> bool:
    if abs(len(a) - len(b)) > 1:
        return False
    if a == b:
        return True
    if len(a) == len(b):
        return sum(c1 != c2 for c1, c2 in zip(a, b)) <= 1
    if len(a) > len(b):
        a, b = b, a
    i = j = edits = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
        else:
            edits += 1
            j += 1
            if edits > 1:
                return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default="../data/vi_wiktionary_pos.txt")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--report", default="word_validation_report.txt")
    args = parser.parse_args()

    path = Path(args.path).resolve()
    raw_words = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    candidates: list[tuple[str, str]] = []
    rejected: list[tuple[str, str]] = []
    for word in raw_words:
        slug = slugify(word)
        if not word:
            rejected.append((word, "empty"))
        elif not is_valid_word_slug(slug):
            rejected.append((word, "unsupported characters, digits, or too short"))
        else:
            candidates.append((word, slug))

    counts = Counter(slug for _, slug in candidates)
    duplicate_slugs = sorted(slug for slug, count in counts.items() if count > 1)
    if duplicate_slugs:
        for word, slug in candidates:
            if counts[slug] > 1:
                rejected.append((word, f"duplicate slug: {slug}"))
        candidates = [(word, slug) for word, slug in candidates if counts[slug] == 1]

    warnings: list[str] = []
    by_len: dict[int, list[str]] = {}
    for _, slug in candidates:
        by_len.setdefault(len(slug), []).append(slug)
    seen_warning_pairs = 0
    for length, slugs in by_len.items():
        nearby = slugs + by_len.get(length - 1, []) + by_len.get(length + 1, [])
        for i, slug in enumerate(slugs):
            for other in nearby:
                if slug >= other:
                    continue
                if levenshtein_leq_one(slug, other):
                    warnings.append(f"similar words: {slug} / {other}")
                    seen_warning_pairs += 1
                    if seen_warning_pairs >= 500:
                        warnings.append("similarity warning limit reached; curate words offline for production")
                        break
            if seen_warning_pairs >= 500:
                break
        if seen_warning_pairs >= 500:
            break

    with get_conn() as conn:
        if args.replace:
            conn.execute("TRUNCATE words RESTART IDENTITY CASCADE")
        for idx, (display, slug) in enumerate(candidates):
            conn.execute(
                """
                INSERT INTO words (id, display, slug, is_active)
                VALUES (%s, %s, %s, true)
                ON CONFLICT (id) DO UPDATE SET display = EXCLUDED.display, slug = EXCLUDED.slug, is_active = true
                """,
                (idx, display, slug),
            )
        conn.commit()

    report = [
        f"total_input_words={len(raw_words)}",
        f"active_words={len(candidates)}",
        f"duplicate_slugs={len(duplicate_slugs)}",
        f"rejected_words={len(rejected)}",
        "",
        "Rejected samples:",
        *[f"{word}\t{reason}" for word, reason in rejected[:200]],
        "",
        "Warnings:",
        *warnings,
    ]
    Path(args.report).write_text("\n".join(report), encoding="utf-8")
    print(f"Imported {len(candidates)} active words from {len(raw_words)} input lines")
    print(f"Rejected {len(rejected)} words; duplicate slugs: {len(duplicate_slugs)}")
    print(f"Wrote validation report to {args.report}")


if __name__ == "__main__":
    main()

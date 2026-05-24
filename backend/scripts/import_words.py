import argparse
import csv
from collections import Counter
from pathlib import Path

from app.db import get_conn
from app.services.normalize import is_valid_word_slug, slugify


DEFAULT_CSV_WORD_COLUMNS = ("word", "normalized_word", "display", "text", "term", "slug")


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


def read_word_source(path: Path, word_column: str | None = None) -> list[str]:
    if path.suffix.lower() != ".csv":
        return [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]

    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return []
        fieldnames = [field.strip() for field in reader.fieldnames if field]
        selected_column = word_column
        if selected_column is None:
            selected_column = next((column for column in DEFAULT_CSV_WORD_COLUMNS if column in fieldnames), None)
        if selected_column is None:
            selected_column = fieldnames[0]
        if selected_column not in fieldnames:
            raise SystemExit(
                f"CSV word column '{selected_column}' not found in {path}. Available columns: {', '.join(fieldnames)}"
            )
        return [(row.get(selected_column) or "").strip() for row in reader]


def validate_words(raw_words: list[str], duplicate_policy: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]], list[str]]:
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
    if duplicate_slugs and duplicate_policy == "error":
        raise SystemExit(f"Found {len(duplicate_slugs)} duplicate normalized word slugs. See report for details.")
    if duplicate_slugs and duplicate_policy == "reject-all":
        for word, slug in candidates:
            if counts[slug] > 1:
                rejected.append((word, f"duplicate slug: {slug}"))
        candidates = [(word, slug) for word, slug in candidates if counts[slug] == 1]
    elif duplicate_slugs and duplicate_policy == "keep-first":
        seen: set[str] = set()
        deduped: list[tuple[str, str]] = []
        for word, slug in candidates:
            if slug in seen:
                rejected.append((word, f"duplicate slug kept earlier: {slug}"))
                continue
            seen.add(slug)
            deduped.append((word, slug))
        candidates = deduped

    return candidates, rejected, duplicate_slugs


def similarity_warnings(candidates: list[tuple[str, str]], limit: int = 500) -> list[str]:
    warnings: list[str] = []
    by_len: dict[int, list[str]] = {}
    for _, slug in candidates:
        by_len.setdefault(len(slug), []).append(slug)
    seen_warning_pairs = 0
    for length, slugs in by_len.items():
        nearby = slugs + by_len.get(length - 1, []) + by_len.get(length + 1, [])
        for slug in slugs:
            for other in nearby:
                if slug >= other:
                    continue
                if levenshtein_leq_one(slug, other):
                    warnings.append(f"similar words: {slug} / {other}")
                    seen_warning_pairs += 1
                    if seen_warning_pairs >= limit:
                        warnings.append("similarity warning limit reached; curate words offline for production")
                        return warnings
    return warnings


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default="../data/final/all_ranked_words_36.csv")
    parser.add_argument("--word-column", help="CSV column to import. Defaults to word, normalized_word, or the first column.")
    parser.add_argument("--limit", type=int, default=0, help="Only read the top N rows/lines from the word source.")
    parser.add_argument(
        "--duplicate-policy",
        choices=("reject-all", "keep-first", "error"),
        default="reject-all",
        help="How to handle words that normalize to the same slug.",
    )
    parser.add_argument("--min-count", type=int, default=0, help="Fail if fewer than this many active words remain after validation.")
    parser.add_argument(
        "--keep-grid",
        action="store_true",
        help="Do not invalidate existing grid/code metadata when replacing words.",
    )
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--report", default="word_validation_report.txt")
    args = parser.parse_args()

    path = Path(args.path).resolve()
    raw_words = read_word_source(path, args.word_column)
    if args.limit:
        raw_words = raw_words[: args.limit]
    candidates, rejected, duplicate_slugs = validate_words(raw_words, args.duplicate_policy)
    warnings = similarity_warnings(candidates)
    report = [
        f"total_input_words={len(raw_words)}",
        f"active_words={len(candidates)}",
        f"source_path={path}",
        f"duplicate_policy={args.duplicate_policy}",
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

    if args.min_count and len(candidates) < args.min_count:
        raise SystemExit(f"Only {len(candidates)} active words remain after validation; {args.min_count} required.")

    with get_conn() as conn:
        if args.replace:
            if not args.keep_grid:
                conn.execute("TRUNCATE admin_grid_intervals, admin_code_params, grid_versions RESTART IDENTITY CASCADE")
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

    print(f"Imported {len(candidates)} active words from {len(raw_words)} input lines")
    print(f"Rejected {len(rejected)} words; duplicate slugs: {len(duplicate_slugs)}")
    print(f"Wrote validation report to {args.report}")


if __name__ == "__main__":
    main()

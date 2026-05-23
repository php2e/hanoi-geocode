import argparse
import csv
import random
import statistics
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import psycopg
from fastapi import HTTPException

from app.db import get_conn
from app.services import geocode_core
from app.services.geometry import lonlat_to_xy


Failure = dict[str, Any]


@contextmanager
def shared_conn(conn):
    yield conn


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Hanoi location code roundtrips.")
    parser.add_argument("--samples", type=int, default=10000)
    parser.add_argument("--report", default="geocode_validation_failures.csv")
    parser.add_argument("--seed", type=int)
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    failures: list[Failure] = []
    encode_latencies: list[float] = []
    decode_latencies: list[float] = []

    try:
        with get_conn() as conn:
            original_get_conn = geocode_core.get_conn
            geocode_core.get_conn = lambda: shared_conn(conn)
            try:
                samples = sample_interior_points(conn, args.samples)
                random.shuffle(samples)
                for index, sample in enumerate(samples, start=1):
                    validate_roundtrip(sample, index, failures, encode_latencies, decode_latencies)

                validate_boundary_cases(conn, failures)
                validate_error_cases(failures)
            finally:
                geocode_core.get_conn = original_get_conn
    except psycopg.OperationalError as exc:
        raise SystemExit(f"Could not connect to database. Check DATABASE_URL and run database setup first.\n{exc}") from exc

    write_failures(Path(args.report), failures)
    print_summary(args.samples, failures, encode_latencies, decode_latencies, Path(args.report))
    if failures:
        raise SystemExit(1)


def sample_interior_points(conn, sample_count: int) -> list[dict]:
    admin_count = conn.execute("SELECT count(*) AS count FROM admin_units").fetchone()["count"]
    if admin_count <= 0:
        raise SystemExit("No admin units found. Run import-admin first.")

    per_admin = max(1, sample_count // admin_count + 2)
    rows = conn.execute(
        """
        WITH points AS (
          SELECT
            a.id AS admin_id,
            a.slug AS admin_slug,
            a.name AS admin_name,
            (ST_DumpPoints(ST_GeneratePoints(a.geom_4326, %s))).geom AS geom_4326,
            a.geom_32648 AS admin_geom_32648
          FROM admin_units a
        )
        SELECT
          admin_id,
          admin_slug,
          admin_name,
          ST_Y(geom_4326) AS lat,
          ST_X(geom_4326) AS lon,
          ST_Distance(ST_Boundary(admin_geom_32648), ST_Transform(geom_4326, 32648)) AS boundary_distance_m
        FROM points
        ORDER BY random()
        LIMIT %s
        """,
        (per_admin, sample_count),
    ).fetchall()
    return [dict(row) for row in rows]


def validate_roundtrip(
    sample: dict,
    index: int,
    failures: list[Failure],
    encode_latencies: list[float],
    decode_latencies: list[float],
) -> None:
    try:
        encoded, encode_ms = timed(lambda: geocode_core.encode_point(sample["lat"], sample["lon"]))
        decoded, decode_ms = timed(lambda: geocode_core.decode_code(encoded["code"]))
        encoded_again, encode_again_ms = timed(lambda: geocode_core.encode_point(decoded["center"]["lat"], decoded["center"]["lon"]))
        encode_latencies.extend([encode_ms, encode_again_ms])
        decode_latencies.append(decode_ms)

        if decoded["code"] != encoded["code"]:
            failures.append(failure("roundtrip_decode_changed", sample, index, encoded["code"], decoded["code"]))
        if encoded_again["code"] != encoded["code"]:
            failures.append(failure("roundtrip_reencode_changed", sample, index, encoded["code"], encoded_again["code"]))

        distance_m = point_distance_m(sample["lat"], sample["lon"], decoded["center"]["lat"], decoded["center"]["lon"])
        if sample["boundary_distance_m"] > 3 and distance_m > 3:
            detail = f"distance_m={distance_m:.3f}; boundary_distance_m={sample['boundary_distance_m']:.3f}"
            failures.append(failure("decoded_center_too_far", sample, index, encoded["code"], detail))
    except Exception as exc:
        failures.append(failure("roundtrip_exception", sample, index, "", exception_detail(exc)))


def validate_boundary_cases(conn, failures: list[Failure]) -> None:
    expect_api_error(lambda: geocode_core.encode_point(10.0, 10.0), "OUT_OF_SUPPORTED_AREA", "outside_hanoi", failures)

    rows = conn.execute(
        """
        SELECT
          a.slug AS admin_slug,
          a.name AS admin_name,
          ST_Y(ST_Transform(point_on_boundary, 4326)) AS boundary_lat,
          ST_X(ST_Transform(point_on_boundary, 4326)) AS boundary_lon,
          ST_Y(ST_Transform(near_boundary, 4326)) AS near_lat,
          ST_X(ST_Transform(near_boundary, 4326)) AS near_lon
        FROM (
          SELECT
            id,
            slug,
            name,
            ST_PointOnSurface(ST_Boundary(geom_32648)) AS point_on_boundary,
            ST_LineInterpolatePoint(ST_ShortestLine(ST_PointOnSurface(geom_32648), ST_Boundary(geom_32648)), 0.98)
              AS near_boundary
          FROM admin_units
          ORDER BY random()
          LIMIT 10
        ) a
        """
    ).fetchall()

    for index, row in enumerate(rows, start=1):
        check_boundary_point(row, "exact_boundary", row["boundary_lat"], row["boundary_lon"], failures, index)
        check_boundary_point(row, "near_boundary", row["near_lat"], row["near_lon"], failures, index)


def check_boundary_point(row: dict, case: str, lat: float, lon: float, failures: list[Failure], index: int) -> None:
    sample = {
        "admin_slug": row["admin_slug"],
        "admin_name": row["admin_name"],
        "lat": lat,
        "lon": lon,
        "boundary_distance_m": "",
    }
    try:
        encoded = geocode_core.encode_point(lat, lon)
        decoded = geocode_core.decode_code(encoded["code"])
        encoded_again = geocode_core.encode_point(decoded["center"]["lat"], decoded["center"]["lon"])
        if encoded_again["code"] != encoded["code"]:
            failures.append(failure(f"{case}_unstable", sample, index, encoded["code"], encoded_again["code"]))
    except HTTPException as exc:
        allowed = {"OUT_OF_SUPPORTED_AREA", "CELL_NOT_ASSIGNED"}
        if exc.detail.get("code") not in allowed:
            failures.append(failure(f"{case}_unexpected_error", sample, index, "", exception_detail(exc)))
    except Exception as exc:
        failures.append(failure(f"{case}_exception", sample, index, "", exception_detail(exc)))


def validate_error_cases(failures: list[Failure]) -> None:
    cases = [
        ("invalid_code_format", lambda: geocode_core.decode_code("too.many.parts.here"), "INVALID_CODE_FORMAT"),
        ("unknown_admin_unit", lambda: geocode_core.decode_code("not-real.ao-mua.cay-da"), "UNKNOWN_ADMIN_UNIT"),
        ("unknown_word", lambda: geocode_core.decode_code("ba-vi.notaword.cay-da"), "UNKNOWN_WORD"),
    ]
    for case, func, expected_code in cases:
        expect_api_error(func, expected_code, case, failures)


def expect_api_error(func, expected_code: str, case: str, failures: list[Failure]) -> None:
    try:
        func()
    except HTTPException as exc:
        actual_code = exc.detail.get("code")
        if actual_code != expected_code:
            failures.append(failure(case, {}, 0, expected_code, f"got {actual_code}: {exc.detail}"))
    except Exception as exc:
        failures.append(failure(case, {}, 0, expected_code, exception_detail(exc)))
    else:
        failures.append(failure(case, {}, 0, expected_code, "request succeeded unexpectedly"))


def timed(func):
    start = time.perf_counter()
    result = func()
    elapsed_ms = (time.perf_counter() - start) * 1000
    return result, elapsed_ms


def point_distance_m(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    x_a, y_a = lonlat_to_xy(lon_a, lat_a)
    x_b, y_b = lonlat_to_xy(lon_b, lat_b)
    return ((x_a - x_b) ** 2 + (y_a - y_b) ** 2) ** 0.5


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = min(len(sorted_values) - 1, round((pct / 100) * (len(sorted_values) - 1)))
    return sorted_values[index]


def failure(case: str, sample: dict, sample_index: int, code: str, detail: str) -> Failure:
    return {
        "case": case,
        "sample_index": sample_index,
        "admin_slug": sample.get("admin_slug", ""),
        "admin_name": sample.get("admin_name", ""),
        "lat": sample.get("lat", ""),
        "lon": sample.get("lon", ""),
        "boundary_distance_m": sample.get("boundary_distance_m", ""),
        "code": code,
        "detail": detail,
    }


def exception_detail(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        return str(exc.detail)
    return f"{type(exc).__name__}: {exc}"


def write_failures(path: Path, failures: list[Failure]) -> None:
    fieldnames = ["case", "sample_index", "admin_slug", "admin_name", "lat", "lon", "boundary_distance_m", "code", "detail"]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(failures)


def print_summary(
    requested_samples: int,
    failures: list[Failure],
    encode_latencies: list[float],
    decode_latencies: list[float],
    report_path: Path,
) -> None:
    print(f"Requested samples: {requested_samples}")
    print(f"Failures: {len(failures)}")
    print(f"Failure report: {report_path}")
    print(f"Encode latency p50/p95: {statistics.median(encode_latencies or [0]):.2f} ms / {percentile(encode_latencies, 95):.2f} ms")
    print(f"Decode latency p50/p95: {statistics.median(decode_latencies or [0]):.2f} ms / {percentile(decode_latencies, 95):.2f} ms")


if __name__ == "__main__":
    main()

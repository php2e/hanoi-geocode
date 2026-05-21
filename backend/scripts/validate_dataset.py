import argparse
import random

from app.db import get_conn
from app.services.geocode_core import decode_code, encode_point


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-admin-count", type=int, default=126)
    parser.add_argument("--samples", type=int, default=20)
    args = parser.parse_args()

    with get_conn() as conn:
        admin_count = conn.execute("SELECT count(*) AS count FROM admin_units").fetchone()["count"]
        invalid_count = conn.execute("SELECT count(*) AS count FROM admin_units WHERE NOT ST_IsValid(geom_4326)").fetchone()["count"]
        total_area = conn.execute("SELECT sum(area_km2) AS area FROM admin_units").fetchone()["area"]
        missing_intervals = conn.execute(
            """
            SELECT count(*) AS count
            FROM admin_units a
            LEFT JOIN admin_code_params p ON p.admin_unit_id = a.id
            WHERE p.admin_unit_id IS NULL
            """
        ).fetchone()["count"]
        if admin_count != args.expected_admin_count:
            raise SystemExit(f"Expected {args.expected_admin_count} admin units, found {admin_count}")
        if invalid_count:
            raise SystemExit(f"Found {invalid_count} invalid admin geometries")
        if missing_intervals:
            raise SystemExit(f"{missing_intervals} admin units have no built intervals")
        print(f"Admin units: {admin_count}; total area: {total_area:.2f} km2")

        sample_rows = conn.execute(
            """
            SELECT ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon
            FROM (
              SELECT (ST_DumpPoints(ST_GeneratePoints(geom_4326, %s))).geom AS geom
              FROM admin_units
              ORDER BY random()
              LIMIT 5
            ) p
            LIMIT %s
            """,
            (max(args.samples, 1), args.samples),
        ).fetchall()

    random.shuffle(sample_rows)
    for row in sample_rows[: args.samples]:
        encoded = encode_point(row["lat"], row["lon"])
        decoded = decode_code(encoded["code"])
        if decoded["code"] != encoded["code"]:
            raise SystemExit(f"Roundtrip changed code: {encoded['code']} -> {decoded['code']}")
    print(f"Roundtrip samples passed: {len(sample_rows[: args.samples])}")


if __name__ == "__main__":
    main()

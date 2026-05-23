from fastapi import HTTPException

from scripts.validate_geocode import expect_api_error, failure, percentile


def test_percentile_uses_sorted_values():
    assert percentile([30, 10, 20], 50) == 20
    assert percentile([30, 10, 20], 95) == 30


def test_failure_row_contains_report_columns():
    row = failure(
        "roundtrip_decode_changed",
        {"admin_slug": "ba-vi", "admin_name": "Ba Vì", "lat": 21.0, "lon": 105.0, "boundary_distance_m": 10},
        7,
        "ba-vi.ao-mua.cay-da",
        "changed",
    )
    assert row["case"] == "roundtrip_decode_changed"
    assert row["admin_slug"] == "ba-vi"
    assert row["sample_index"] == 7


def test_expect_api_error_accepts_expected_structured_error():
    failures = []
    expect_api_error(
        lambda: (_ for _ in ()).throw(HTTPException(status_code=400, detail={"code": "INVALID_CODE_FORMAT"})),
        "INVALID_CODE_FORMAT",
        "invalid_code_format",
        failures,
    )
    assert failures == []


def test_expect_api_error_reports_unexpected_success():
    failures = []
    expect_api_error(lambda: None, "INVALID_CODE_FORMAT", "invalid_code_format", failures)
    assert failures[0]["case"] == "invalid_code_format"
    assert "unexpectedly" in failures[0]["detail"]

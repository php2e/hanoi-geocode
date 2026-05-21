from shapely.geometry import Polygon

from scripts.build_grid_intervals import build_intervals_for_polygon, insert_grid_intervals


def test_xy_local_index_roundtrip_for_generated_intervals():
    poly = Polygon([(0, 0), (9, 0), (9, 9), (0, 9), (0, 0)])
    intervals, cell_count = build_intervals_for_polygon(poly, 1, 1, 0, 0, 3)
    assert cell_count == 9
    for interval in intervals:
        _, _, y_index, x_start, x_end, _, cumulative_start, _ = interval
        for x_index in range(x_start, x_end + 1):
            local_index = cumulative_start + (x_index - x_start)
            found = next(row for row in intervals if row[6] <= local_index <= row[7])
            assert found[2] == y_index
            assert found[3] + (local_index - found[6]) == x_index


class FakeCursor:
    def __init__(self):
        self.executemany_calls = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def executemany(self, sql, rows):
        self.executemany_calls.append((sql, rows))


class FakePsycopg3Connection:
    def __init__(self):
        self.cursor_obj = FakeCursor()

    def cursor(self):
        return self.cursor_obj

    def executemany(self, *_args, **_kwargs):
        raise AssertionError("psycopg3 bulk inserts must use cursor.executemany")


def test_insert_grid_intervals_uses_cursor_executemany():
    conn = FakePsycopg3Connection()
    rows = [(1, 2, 3, 4, 5, 2, 0, 1)]

    insert_grid_intervals(conn, rows)

    assert len(conn.cursor_obj.executemany_calls) == 1
    sql, inserted_rows = conn.cursor_obj.executemany_calls[0]
    assert "INSERT INTO admin_grid_intervals" in sql
    assert inserted_rows == rows

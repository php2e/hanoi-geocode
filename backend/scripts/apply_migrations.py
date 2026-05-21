from pathlib import Path

from app.db import get_conn


def main() -> None:
    migrations_dir = Path(__file__).resolve().parents[1] / "migrations"
    with get_conn() as conn:
        for path in sorted(migrations_dir.glob("*.sql")):
            print(f"Applying {path.name}")
            conn.execute(path.read_text(encoding="utf-8"))
        conn.commit()


if __name__ == "__main__":
    main()

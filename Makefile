DATABASE_URL ?= postgresql://hanoi:hanoi@localhost:15432/hanoi_geocode

.PHONY: db-up db-down migrate import-admin import-words build-grid backend web test validate

db-up:
	docker compose up -d db

db-down:
	docker compose down

migrate:
	cd backend && DATABASE_URL=$(DATABASE_URL) python -m scripts.apply_migrations

import-admin:
	cd backend && DATABASE_URL=$(DATABASE_URL) python -m scripts.import_admin_units --replace

import-words:
	cd backend && DATABASE_URL=$(DATABASE_URL) python -m scripts.import_words --replace

build-grid:
	cd backend && DATABASE_URL=$(DATABASE_URL) python -m scripts.build_grid_intervals --cell-size 3 --rebuild

backend:
	cd backend && DATABASE_URL=$(DATABASE_URL) uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

web:
	cd web && npm run dev

test:
	cd backend && pytest

validate:
	cd backend && DATABASE_URL=$(DATABASE_URL) python -m scripts.validate_dataset

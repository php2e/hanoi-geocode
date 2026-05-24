DATABASE_URL ?= postgresql://hanoi:hanoi@localhost:15432/hanoi_geocode
WORDS_PATH ?= ../data/final/all_ranked_words_36.csv
WORDS_COLUMN ?= word
WORDS_LIMIT ?= 3071
WORDS_DUPLICATE_POLICY ?= keep-first
WORDS_MIN_COUNT ?= 2988

.PHONY: db-up db-up-host db-down db-check tiles-up tiles-down tiles-logs migrate import-admin import-words build-grid backend web test validate

db-up:
	docker compose up -d db

db-up-host:
	docker compose up -d db-host

db-down:
	docker compose down

db-check:
	docker compose ps
	docker compose exec db pg_isready -U hanoi -d hanoi_geocode || docker compose exec db-host pg_isready -h localhost -p 15432 -U hanoi -d hanoi_geocode

tiles-up:
	docker compose up -d tileserver

tiles-down:
	docker compose stop tileserver

tiles-logs:
	docker compose logs -f tileserver

migrate:
	cd backend && DATABASE_URL=$(DATABASE_URL) python -m scripts.apply_migrations

import-admin:
	cd backend && DATABASE_URL=$(DATABASE_URL) python -m scripts.import_admin_units --replace

import-words:
	cd backend && DATABASE_URL=$(DATABASE_URL) python -m scripts.import_words --replace --path $(WORDS_PATH) --word-column $(WORDS_COLUMN) --limit $(WORDS_LIMIT) --duplicate-policy $(WORDS_DUPLICATE_POLICY) --min-count $(WORDS_MIN_COUNT)

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


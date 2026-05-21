CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS admin_units (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  unit_type text NULL,
  admin_level int NULL,
  source text NULL,
  boundary_version text NOT NULL DEFAULT 'hanoi-2026-v1',
  geom_4326 geometry(MultiPolygon, 4326) NOT NULL,
  geom_32648 geometry(MultiPolygon, 32648) NOT NULL,
  area_km2 double precision,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_units_geom_4326_gix ON admin_units USING gist (geom_4326);
CREATE INDEX IF NOT EXISTS admin_units_geom_32648_gix ON admin_units USING gist (geom_32648);
CREATE UNIQUE INDEX IF NOT EXISTS admin_units_slug_uix ON admin_units (slug);

CREATE TABLE IF NOT EXISTS words (
  id int PRIMARY KEY,
  display text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS grid_versions (
  id bigserial PRIMARY KEY,
  version text NOT NULL UNIQUE,
  crs text NOT NULL,
  cell_size_m double precision NOT NULL,
  origin_x double precision NOT NULL,
  origin_y double precision NOT NULL,
  boundary_version text NOT NULL,
  word_count int NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_grid_intervals (
  id bigserial PRIMARY KEY,
  grid_version_id bigint NOT NULL REFERENCES grid_versions(id),
  admin_unit_id bigint NOT NULL REFERENCES admin_units(id),
  y_index bigint NOT NULL,
  x_start bigint NOT NULL,
  x_end bigint NOT NULL,
  interval_count bigint NOT NULL,
  cumulative_start bigint NOT NULL,
  cumulative_end bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_grid_intervals_row_ix ON admin_grid_intervals (admin_unit_id, y_index);
CREATE INDEX IF NOT EXISTS admin_grid_intervals_cumulative_ix ON admin_grid_intervals (admin_unit_id, cumulative_start, cumulative_end);
CREATE INDEX IF NOT EXISTS admin_grid_intervals_grid_admin_ix ON admin_grid_intervals (grid_version_id, admin_unit_id);

CREATE TABLE IF NOT EXISTS admin_code_params (
  admin_unit_id bigint PRIMARY KEY REFERENCES admin_units(id),
  grid_version_id bigint NOT NULL REFERENCES grid_versions(id),
  word_count int NOT NULL,
  pair_capacity bigint NOT NULL,
  multiplier bigint NOT NULL,
  offset_value bigint NOT NULL,
  cell_count bigint NOT NULL
);

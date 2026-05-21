# Data Assumptions

- Canonical local inputs are `data/hanoi_bound_2026.geojson`, `data/hanoi_wards_2026.geojson`, and `data/vi_wiktionary_pos.txt`.
- Ward/commune boundaries come from the user-provided `hanoi_wards_2026.geojson`.
- Hanoi boundary comes from the user-provided `hanoi_bound_2026.geojson`.
- Hanoi is the only supported area.
- Public input/output coordinates use EPSG:4326.
- Internal grid calculations use EPSG:32648.
- A point is assigned to the ward/commune that covers it; boundary edge handling uses `ST_Covers`.
- A grid cell is assigned to an admin unit if its center point is covered by that admin unit.
- The boundary data appears derived from OSM/QuickOSM-style properties and is not treated as legally authoritative.
- Word quality is a first-pass demo list. Import rejects invalid and duplicate slugs and warns on very similar words, but future curation is required.

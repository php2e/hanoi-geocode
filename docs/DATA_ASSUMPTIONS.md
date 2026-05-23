# Data Assumptions

- Canonical local inputs are `data/hanoi_bound_2026.geojson`, `data/hanoi_wards_2026.geojson`, and a curated ranked word source such as `data/model_v10/all_ranked_words.csv`.
- Ward/commune boundaries come from the user-provided `hanoi_wards_2026.geojson`.
- Hanoi boundary comes from the user-provided `hanoi_bound_2026.geojson`.
- Hanoi is the only supported area.
- Public input/output coordinates use EPSG:4326.
- Internal grid calculations use EPSG:32648.
- A point is assigned to the ward/commune that covers it; boundary edge handling uses `ST_Covers`.
- A grid cell is assigned to an admin unit if its center point is covered by that admin unit.
- The boundary data appears derived from OSM/QuickOSM-style properties and is not treated as legally authoritative.
- Word import accepts plain-text or CSV sources. Duplicate normalized slugs cannot both be active because public code parsing strips accents; ranked CSV sources should keep the first occurrence and reject later collisions.
- For the current 3m grid, the active word source must provide at least 2988 unique normalized slugs. In `all_ranked_words.csv`, the top 3071 rows are the first top-N slice that reaches that count.

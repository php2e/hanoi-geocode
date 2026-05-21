# Limitations

- Web demo only; no mobile app.
- No user accounts, routing, offline mode, or address search.
- Administrative boundaries are not legally guaranteed.
- The word list is not final and requires product/legal/linguistic curation.
- The 3m grid interval build is computationally expensive and intentionally offline.
- Boundary endpoints serve full GeoJSON for demo simplicity; production should tile or simplify large boundary layers.
- Codes are stable for the same boundary version, grid version, and active word list. Changing those inputs requires versioning and migration policy.

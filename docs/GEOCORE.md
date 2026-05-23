# Geocoding Core

Public API coordinates are EPSG:4326 latitude/longitude. Grid calculations use EPSG:32648 because grid cells are defined in meters; latitude/longitude degrees are not uniform distances.

One global Hanoi grid is built from the Hanoi boundary bbox in EPSG:32648. The origin is rounded down to the nearest cell-size multiple. For a point `(x, y)`:

```text
x_index = floor((x - origin_x) / cell_size_m)
y_index = floor((y - origin_y) / cell_size_m)
```

The cell center is:

```text
center_x = origin_x + (x_index + 0.5) * cell_size_m
center_y = origin_y + (y_index + 0.5) * cell_size_m
```

## Row Intervals

Hanoi has hundreds of millions of 3m cells. The system does not pre-generate every cell. For each admin polygon, the builder scans grid-center rows and intersects each row with the polygon. Consecutive x-index ranges are stored as:

```text
y_index, x_start, x_end, interval_count, cumulative_start, cumulative_end
```

This supports indexed lookup from `x/y -> local_index` and binary/indexed lookup from `local_index -> x/y`.

## Encode

Encode validates lat/lon, finds the ward/commune with `ST_Covers`, transforms the point to EPSG:32648, computes x/y indexes, finds the row interval, computes `local_index`, maps it through the deterministic word permutation, and returns the cell center and polygon in EPSG:4326.

## Decode

Decode normalizes `admin.word1.word2`, resolves the admin unit and words, reverses the permutation to `local_index`, finds the interval covering that index, reconstructs x/y indexes, and returns the generated cell geometry.

## Word Mapping

For `word_count` active words, pair capacity is `word_count * word_count`.

```text
permuted_index = (local_index * multiplier + offset_value) mod pair_capacity
```

The multiplier is chosen so it is coprime with pair capacity. Multiplier and offset are derived from SHA-256 over stable inputs and stored in `admin_code_params`; Python's randomized built-in `hash()` is never used.

Changing the active word source changes word IDs, pair capacity, and generated codes. The word import command invalidates existing grid/code metadata on replace; rebuild the grid after importing a new source so encode and decode use the same word list and parameters.

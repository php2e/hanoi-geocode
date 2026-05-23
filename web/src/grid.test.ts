import { describe, expect, it } from "vitest";

import { type GridMetadata, gridIndex, viewportGridLines, viewportGridRange } from "./grid";

const grid: GridMetadata = {
  version: "test",
  crs: "EPSG:32648",
  cell_size_m: 3,
  origin_x: 0,
  origin_y: 0,
};

const hanoiBounds = {
  getWest: () => 105.8399,
  getSouth: () => 21.0299,
  getEast: () => 105.8401,
  getNorth: () => 21.0301,
};

describe("viewport grid", () => {
  it("calculates grid indices from origin and cell size", () => {
    expect(gridIndex(0, 0, 3)).toBe(0);
    expect(gridIndex(2.99, 0, 3)).toBe(0);
    expect(gridIndex(3, 0, 3)).toBe(1);
    expect(gridIndex(-0.1, 0, 3)).toBe(-1);
  });

  it("calculates a viewport grid range", () => {
    const range = viewportGridRange(hanoiBounds, grid);
    expect(range.maxXIndex).toBeGreaterThan(range.minXIndex);
    expect(range.maxYIndex).toBeGreaterThan(range.minYIndex);
  });

  it("hides the grid below the zoom threshold", () => {
    const result = viewportGridLines(hanoiBounds, 17.9, grid);
    expect(result.hiddenReason).toBe("Zoom in to see the 3m grid");
    expect(result.hiddenCode).toBe("zoom_too_low");
    expect(result.data.features).toHaveLength(0);
  });

  it("hides the grid when it would exceed the max line threshold", () => {
    const result = viewportGridLines(hanoiBounds, 18, grid, 1);
    expect(result.hiddenReason).toBe("Zoom in to see the 3m grid");
    expect(result.hiddenCode).toBe("too_many_lines");
    expect(result.lineCount).toBeGreaterThan(1);
  });

  it("returns line features when zoomed in and under the line threshold", () => {
    const result = viewportGridLines(hanoiBounds, 18.5, grid, 1000);
    expect(result.hiddenReason).toBeNull();
    expect(result.data.features.length).toBe(result.lineCount);
    expect(result.verticalLineCount).toBeGreaterThan(0);
    expect(result.horizontalLineCount).toBeGreaterThan(0);
  });
});

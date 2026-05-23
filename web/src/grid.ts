import proj4 from "proj4";

proj4.defs("EPSG:32648", "+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs +type=crs");

export type GridMetadata = {
  version: string;
  crs: "EPSG:32648" | string;
  cell_size_m: number;
  origin_x: number;
  origin_y: number;
};

export type LngLatBoundsLike = {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
};

export type ViewportGridResult = {
  data: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  hiddenReason: string | null;
  hiddenCode: "zoom_too_low" | "too_many_lines" | "projection_error" | null;
  verticalLineCount: number;
  horizontalLineCount: number;
  lineCount: number;
};

export const GRID_MIN_ZOOM = 18;
export const MAX_GRID_LINES = 500;

type Point = [number, number];

export function gridIndex(value: number, origin: number, cellSize: number): number {
  return Math.floor((value - origin) / cellSize);
}

export function viewportGridRange(bounds: LngLatBoundsLike, grid: GridMetadata) {
  const corners = boundsToUtmCorners(bounds);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    minXIndex: gridIndex(Math.min(...xs), grid.origin_x, grid.cell_size_m),
    maxXIndex: Math.ceil((Math.max(...xs) - grid.origin_x) / grid.cell_size_m),
    minYIndex: gridIndex(Math.min(...ys), grid.origin_y, grid.cell_size_m),
    maxYIndex: Math.ceil((Math.max(...ys) - grid.origin_y) / grid.cell_size_m),
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function viewportGridLines(
  bounds: LngLatBoundsLike,
  zoom: number,
  grid: GridMetadata,
  maxLines = MAX_GRID_LINES,
): ViewportGridResult {
  if (zoom < GRID_MIN_ZOOM) return hiddenGrid("Zoom in to see the 3m grid", "zoom_too_low");

  let range: ReturnType<typeof viewportGridRange>;
  try {
    range = viewportGridRange(bounds, grid);
  } catch {
    return hiddenGrid("Zoom in to see the 3m grid", "projection_error");
  }
  const verticalLineCount = range.maxXIndex - range.minXIndex + 1;
  const horizontalLineCount = range.maxYIndex - range.minYIndex + 1;
  const lineCount = verticalLineCount + horizontalLineCount;
  if (lineCount > maxLines) {
    return {
      ...hiddenGrid("Zoom in to see the 3m grid", "too_many_lines"),
      verticalLineCount,
      horizontalLineCount,
      lineCount,
    };
  }

  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (let xIndex = range.minXIndex; xIndex <= range.maxXIndex; xIndex += 1) {
    const x = grid.origin_x + xIndex * grid.cell_size_m;
    features.push(lineFeature(utmToLngLat([x, range.minY]), utmToLngLat([x, range.maxY])));
  }
  for (let yIndex = range.minYIndex; yIndex <= range.maxYIndex; yIndex += 1) {
    const y = grid.origin_y + yIndex * grid.cell_size_m;
    features.push(lineFeature(utmToLngLat([range.minX, y]), utmToLngLat([range.maxX, y])));
  }

  return { data: { type: "FeatureCollection", features }, hiddenReason: null, hiddenCode: null, verticalLineCount, horizontalLineCount, lineCount };
}

function boundsToUtmCorners(bounds: LngLatBoundsLike): Point[] {
  return [
    lngLatToUtm([bounds.getWest(), bounds.getSouth()]),
    lngLatToUtm([bounds.getWest(), bounds.getNorth()]),
    lngLatToUtm([bounds.getEast(), bounds.getSouth()]),
    lngLatToUtm([bounds.getEast(), bounds.getNorth()]),
  ];
}

function lngLatToUtm(point: Point): Point {
  return proj4("EPSG:4326", "EPSG:32648", point) as Point;
}

function utmToLngLat(point: Point): Point {
  return proj4("EPSG:32648", "EPSG:4326", point) as Point;
}

function lineFeature(start: Point, end: Point): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [start, end] } };
}

function hiddenGrid(hiddenReason: string, hiddenCode: ViewportGridResult["hiddenCode"]): ViewportGridResult {
  return { data: { type: "FeatureCollection", features: [] }, hiddenReason, hiddenCode, verticalLineCount: 0, horizontalLineCount: 0, lineCount: 0 };
}

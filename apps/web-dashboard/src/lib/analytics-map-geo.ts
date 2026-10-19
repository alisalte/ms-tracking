import { activityColor } from '@/lib/spatial-analytics';

/**
 * Pure geometry for the spatial-analytics map.
 *
 * The page legend paints coverage / activity ranges in color, but the MapLibre
 * raster basemap sits on top of fill layers and a 250 m cell is often smaller
 * than a pixel once the camera frames a whole project. These helpers feed an
 * SVG overlay (screen pixels, minimum size) and a camera fit that uses every
 * layer — not only a hull that can sit in a different place than the cells.
 */

export interface LngLat {
  readonly lat: number;
  readonly lng: number;
}

export interface CellBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export interface HeatSample extends LngLat {
  readonly weight: number;
}

export interface PointSample extends LngLat {
  /** Ranked stops are drawn larger. */
  readonly label?: string;
  readonly color: string;
}

export interface CellSample extends CellBounds {
  readonly color: string;
  /** 0..1 fill opacity. */
  readonly opacity?: number;
}

/** [[west, south], [east, north]] — MapLibre `fitBounds` order. */
export type LngLatBoundsTuple = [[number, number], [number, number]];

/** Screen px. Cells smaller than this disappear into the basemap. */
export const MIN_CELL_PX = 8;

const LAT_MAX = 90;
const LNG_MAX = 180;
/** Cells wider than this are bad data, not a project square. */
const MAX_CELL_DEG = 2;
/** Hull this far from the cells is not the same place — don't fly there. */
const HULL_GAP_DEG = 0.25;

interface Acc {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  n: number;
}

function blank(): Acc {
  return {
    minLat: Number.POSITIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
    n: 0,
  };
}

function validLat(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) <= LAT_MAX;
}

function validLng(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) <= LNG_MAX;
}

function take(acc: Acc, lat: number, lng: number): void {
  if (!validLat(lat) || !validLng(lng)) return;
  acc.minLat = Math.min(acc.minLat, lat);
  acc.maxLat = Math.max(acc.maxLat, lat);
  acc.minLng = Math.min(acc.minLng, lng);
  acc.maxLng = Math.max(acc.maxLng, lng);
  acc.n += 1;
}

function toBounds(acc: Acc): LngLatBoundsTuple | null {
  if (acc.n === 0) return null;
  return [
    [acc.minLng, acc.minLat],
    [acc.maxLng, acc.maxLat],
  ];
}

function union(a: Acc, b: Acc): Acc {
  if (a.n === 0) return b;
  if (b.n === 0) return a;
  return {
    minLat: Math.min(a.minLat, b.minLat),
    minLng: Math.min(a.minLng, b.minLng),
    maxLat: Math.max(a.maxLat, b.maxLat),
    maxLng: Math.max(a.maxLng, b.maxLng),
    n: a.n + b.n,
  };
}

/** True when the two boxes do not meet, even with a small geographic pad. */
function separated(a: Acc, b: Acc): boolean {
  if (a.n === 0 || b.n === 0) return false;
  return (
    a.maxLng + HULL_GAP_DEG < b.minLng ||
    b.maxLng + HULL_GAP_DEG < a.minLng ||
    a.maxLat + HULL_GAP_DEG < b.minLat ||
    b.maxLat + HULL_GAP_DEG < a.minLat
  );
}

function accumulateCells(acc: Acc, cells: readonly CellBounds[]): void {
  for (const c of cells) {
    const south = Math.min(c.south, c.north);
    const north = Math.max(c.south, c.north);
    const west = Math.min(c.west, c.east);
    const east = Math.max(c.west, c.east);
    if (north - south > MAX_CELL_DEG || east - west > MAX_CELL_DEG) continue;
    take(acc, south, west);
    take(acc, north, east);
  }
}

/**
 * Camera bounds for the analytics map. Cells, heat and points are the data
 * the operator came to see. A hull that does not overlap them (bad ring, or a
 * fit that would jump to another city) is left out so the map stays on the
 * colored ranges.
 */
export function analyticsViewBounds(input: {
  cells?: readonly CellBounds[];
  heat?: readonly LngLat[];
  hull?: readonly LngLat[];
  points?: readonly LngLat[];
}): LngLatBoundsTuple | null {
  const data = blank();
  accumulateCells(data, input.cells ?? []);
  for (const p of input.heat ?? []) take(data, p.lat, p.lng);
  for (const p of input.points ?? []) take(data, p.lat, p.lng);

  const hull = blank();
  for (const p of input.hull ?? []) take(hull, p.lat, p.lng);

  if (data.n > 0 && separated(data, hull)) return toBounds(data);
  return toBounds(union(data, hull));
}

/** Grow a screen rect so a sub-pixel grid square stays visible. */
export function expandProjectedRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minPx = MIN_CELL_PX,
): { x1: number; y1: number; x2: number; y2: number } {
  let left = Math.min(x1, x2);
  let top = Math.min(y1, y2);
  let right = Math.max(x1, x2);
  let bottom = Math.max(y1, y2);
  if (right - left < minPx) {
    const cx = (left + right) / 2;
    left = cx - minPx / 2;
    right = cx + minPx / 2;
  }
  if (bottom - top < minPx) {
    const cy = (top + bottom) / 2;
    top = cy - minPx / 2;
    bottom = cy + minPx / 2;
  }
  return { x1: left, y1: top, x2: right, y2: bottom };
}

export interface ProjectedCell {
  readonly points: string;
  readonly color: string;
  readonly opacity: number;
}

export interface ProjectedDot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly color: string;
}

export interface ProjectedAnalyticsOverlay {
  readonly w: number;
  readonly h: number;
  readonly cells: readonly ProjectedCell[];
  readonly heat: readonly ProjectedDot[];
  readonly hull: string | null;
  readonly points: readonly ProjectedDot[];
}

type ProjectFn = (lng: number, lat: number) => { x: number; y: number };

function finitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function onScreen(x1: number, y1: number, x2: number, y2: number, w: number, h: number): boolean {
  const margin = 32;
  return x2 >= -margin && y2 >= -margin && x1 <= w + margin && y1 <= h + margin;
}

/**
 * Screen-space shapes for the SVG overlay. Heat dots are skipped when cells
 * already paint the same grid — otherwise the legend colors show twice.
 */
export function projectAnalyticsOverlay(
  input: {
    cells?: readonly CellSample[];
    heat?: readonly HeatSample[];
    hull?: readonly LngLat[];
    points?: readonly PointSample[];
  },
  project: ProjectFn,
  size: { w: number; h: number },
): ProjectedAnalyticsOverlay | null {
  if (size.w < 8 || size.h < 8) return null;
  const cells: ProjectedCell[] = [];
  for (const c of input.cells ?? []) {
    const south = Math.min(c.south, c.north);
    const north = Math.max(c.south, c.north);
    const west = Math.min(c.west, c.east);
    const east = Math.max(c.west, c.east);
    if (![south, north].every(validLat) || ![west, east].every(validLng)) continue;
    if (north - south > MAX_CELL_DEG || east - west > MAX_CELL_DEG) continue;
    const sw = project(west, south);
    const ne = project(east, north);
    if (!finitePoint(sw) || !finitePoint(ne)) continue;
    const rect = expandProjectedRect(sw.x, sw.y, ne.x, ne.y);
    if (!onScreen(rect.x1, rect.y1, rect.x2, rect.y2, size.w, size.h)) continue;
    cells.push({
      points: `${rect.x1},${rect.y1} ${rect.x2},${rect.y1} ${rect.x2},${rect.y2} ${rect.x1},${rect.y2}`,
      color: c.color,
      opacity: c.opacity ?? 0.55,
    });
  }

  const heat: ProjectedDot[] = [];
  if (cells.length === 0 && (input.heat?.length ?? 0) > 0) {
    const max = (input.heat ?? []).reduce((m, p) => Math.max(m, p.weight), 0) || 1;
    for (const p of input.heat ?? []) {
      if (!validLat(p.lat) || !validLng(p.lng)) continue;
      const pt = project(p.lng, p.lat);
      if (!finitePoint(pt) || !onScreen(pt.x, pt.y, pt.x, pt.y, size.w, size.h)) continue;
      const t = Math.min(1, Math.max(0, p.weight / max));
      heat.push({ x: pt.x, y: pt.y, r: 6 + t * 10, color: activityColor(t) });
    }
  }

  const hullPts: string[] = [];
  for (const p of input.hull ?? []) {
    if (!validLat(p.lat) || !validLng(p.lng)) continue;
    const pt = project(p.lng, p.lat);
    if (!finitePoint(pt)) continue;
    hullPts.push(`${pt.x},${pt.y}`);
  }

  const points: ProjectedDot[] = [];
  for (const p of input.points ?? []) {
    if (!validLat(p.lat) || !validLng(p.lng)) continue;
    const pt = project(p.lng, p.lat);
    if (!finitePoint(pt) || !onScreen(pt.x, pt.y, pt.x, pt.y, size.w, size.h)) continue;
    points.push({
      x: pt.x,
      y: pt.y,
      r: p.label ? 11 : 7,
      color: p.color,
    });
  }

  return {
    w: size.w,
    h: size.h,
    cells,
    heat,
    hull: hullPts.length >= 3 ? hullPts.join(' ') : null,
    points,
  };
}

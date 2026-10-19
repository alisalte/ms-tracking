/**
 * Spatial analytics — pure helpers behind the GPS-coverage heatmap and the
 * movement-pattern report (`GET /positions/analytics/*`).
 *
 * The repository aggregates raw fixes into square grid cells in SQL; these
 * helpers turn the aggregated counters into the operator-facing verdicts
 * (signal score, coverage class) and derive the project working area (the
 * convex hull of the cells the fleet actually uses). No I/O — unit-testable.
 */

/** Metres per degree of latitude (WGS84 mean). */
export const METERS_PER_DEG = 111_320;

export const MIN_CELL_M = 50;
export const MAX_CELL_M = 5_000;
export const DEFAULT_CELL_M = 250;

/** Clamp a client cell size (metres) to the supported band. */
export function clampCellMeters(raw: string | number | undefined): number {
  const n = typeof raw === 'number' ? raw : raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_CELL_M;
  return Math.round(Math.min(Math.max(n, MIN_CELL_M), MAX_CELL_M));
}

/** Grid step in degrees for a cell size in metres (latitude-based, square in degrees). */
export function cellStepDeg(cellM: number): number {
  return cellM / METERS_PER_DEG;
}

/** Bounds of grid cell (gy, gx) for a degree step. */
export function cellBounds(gy: number, gx: number, step: number) {
  const south = gy * step;
  const west = gx * step;
  return {
    south: round6(south),
    west: round6(west),
    north: round6(south + step),
    east: round6(west + step),
    lat: round6(south + step / 2),
    lng: round6(west + step / 2),
  };
}

/** Aggregated GPS-quality counters for one cell (SQL output). */
export interface CoverageCounters {
  /** Fixes recorded in the cell. */
  readonly points: number;
  /** Fixes that carried a satellite count. */
  readonly satPoints: number;
  /** Mean satellites in view (over `satPoints`), or null. */
  readonly avgSatellites: number | null;
  /** Fixes with few satellites (1..4) — a usable but weak fix. */
  readonly weakPoints: number;
  /** Fixes without a GPS fix (0 satellites / device flag "invalid"). */
  readonly noFixPoints: number;
  /** Fixes the pipeline tagged LOW_ACCURACY / SUSPECT_JUMP. */
  readonly lowQualityPoints: number;
  /** Times a vehicle went silent here and re-appeared far away (dead zone). */
  readonly gaps: number;
  /** GPS-loss alarms raised in the cell (merged in by the client or caller). */
  readonly lossAlarms?: number;
}

export type CoverageLevel = 'good' | 'fair' | 'poor' | 'none';

/**
 * Signal score 0..100 for a cell. 100 = every fix clean; each bad signal
 * (weak fix, no fix, flagged jump, silent gap, GPS-loss alarm) eats into it.
 * Gaps and alarms weigh more than a single weak fix because each one means the
 * tracker lost the vehicle for a stretch of road.
 */
export function coverageScore(c: CoverageCounters): number {
  const gaps = c.gaps + (c.lossAlarms ?? 0);
  const total = c.points + gaps;
  if (total <= 0) return 0;
  const penalty = c.weakPoints * 0.6 + c.noFixPoints * 1 + c.lowQualityPoints * 0.8 + gaps * 3;
  const score = 100 * (1 - Math.min(1, penalty / total));
  return Math.round(score);
}

/** Bucket a cell into the legend classes the heatmap paints. */
export function coverageLevel(c: CoverageCounters): CoverageLevel {
  if (c.points === 0) return 'none';
  const score = coverageScore(c);
  if (score >= 75) return 'good';
  if (score >= 45) return 'fair';
  return 'poor';
}

export interface LngLat {
  readonly lng: number;
  readonly lat: number;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, no repeated first point. */
export function convexHull(points: readonly LngLat[]): LngLat[] {
  const uniq = new Map<string, LngLat>();
  for (const p of points) uniq.set(`${p.lng},${p.lat}`, p);
  const pts = [...uniq.values()].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  if (pts.length <= 2) return pts;
  const cross = (o: LngLat, a: LngLat, b: LngLat) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  /** Push `p` onto a monotone chain, popping points that make a clockwise turn. */
  const extend = (chain: LngLat[], p: LngLat) => {
    while (chain.length >= 2) {
      const [o, a] = chain.slice(-2) as [LngLat, LngLat];
      if (cross(o, a, p) > 0) break;
      chain.pop();
    }
    chain.push(p);
  };
  const lower: LngLat[] = [];
  for (const p of pts) extend(lower, p);
  const upper: LngLat[] = [];
  for (const p of [...pts].reverse()) extend(upper, p);
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Polygon area in km² (equirectangular projection around the ring's mean latitude). */
export function polygonAreaKm2(ring: readonly LngLat[]): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const kx = METERS_PER_DEG * Math.cos((meanLat * Math.PI) / 180);
  let twice = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    twice += a.lng * kx * (b.lat * METERS_PER_DEG) - b.lng * kx * (a.lat * METERS_PER_DEG);
  });
  return Math.abs(twice) / 2 / 1_000_000;
}

/** A grid cell with its activity weight (fix count or time spent). */
export interface WeightedCell {
  readonly gy: number;
  readonly gx: number;
  readonly weight: number;
}

export interface ProjectArea {
  /** Hull ring of the cells that hold `coverage` of all activity (closed=false). */
  readonly hull: LngLat[];
  readonly areaKm2: number;
  readonly bbox: { south: number; west: number; north: number; east: number } | null;
  /** Share of activity inside the hull cells (0..1). */
  readonly coverage: number;
  /** Cells that formed the hull. */
  readonly cellCount: number;
}

/**
 * The fleet's working area: keep the busiest cells until they explain
 * `share` (default 95%) of all activity — dropping one-off detours and GPS
 * spikes — then wrap them in a convex hull.
 */
export function projectArea(
  cells: readonly WeightedCell[],
  step: number,
  share = 0.95,
): ProjectArea {
  const total = cells.reduce((s, c) => s + Math.max(0, c.weight), 0);
  if (total <= 0) return { hull: [], areaKm2: 0, bbox: null, coverage: 0, cellCount: 0 };
  const sorted = [...cells].filter((c) => c.weight > 0).sort((a, b) => b.weight - a.weight);
  const kept: WeightedCell[] = [];
  let acc = 0;
  for (const c of sorted) {
    kept.push(c);
    acc += c.weight;
    if (acc / total >= share) break;
  }
  const corners: LngLat[] = [];
  let south = Number.POSITIVE_INFINITY;
  let west = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  for (const c of kept) {
    const b = cellBounds(c.gy, c.gx, step);
    corners.push(
      { lng: b.west, lat: b.south },
      { lng: b.east, lat: b.south },
      { lng: b.east, lat: b.north },
      { lng: b.west, lat: b.north },
    );
    south = Math.min(south, b.south);
    west = Math.min(west, b.west);
    north = Math.max(north, b.north);
    east = Math.max(east, b.east);
  }
  const hull = convexHull(corners).map((p) => ({ lng: round6(p.lng), lat: round6(p.lat) }));
  return {
    hull,
    areaKm2: Math.round(polygonAreaKm2(hull) * 100) / 100,
    bbox: { south, west, north, east },
    coverage: Math.round((acc / total) * 1000) / 1000,
    cellCount: kept.length,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

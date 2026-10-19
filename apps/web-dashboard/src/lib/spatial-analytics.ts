/**
 * Client-side helpers for the spatial analytics page (GPS coverage + movement
 * patterns). Mirrors the gps-engine scoring (`domain/spatial-analytics.ts`) so
 * GPS-loss alarms — which live in notification-service — can be folded into
 * the server's coverage grid without a second round-trip.
 */
import type { CoverageCell, CoverageLevel, MovementResponse } from '@/api/analytics.api';
import type { Alarm } from '@/types/alarm.types';

const METERS_PER_DEG = 111_320;

/**
 * Same 0..100 score the server computes, with GPS-loss alarms weighed like gaps.
 * Capped by the worst single-vehicle score so a fleet-wide cell is never rosier
 * than what its worst-served vehicle saw.
 */
export function coverageScore(c: {
  points: number;
  weakPoints: number;
  noFixPoints: number;
  lowQualityPoints: number;
  gaps: number;
  lossAlarms?: number;
  worstVehicleScore?: number | null;
}): number {
  const gaps = c.gaps + (c.lossAlarms ?? 0);
  const total = c.points + gaps;
  if (total <= 0) return 0;
  const penalty = c.weakPoints * 0.6 + c.noFixPoints + c.lowQualityPoints * 0.8 + gaps * 3;
  const score = Math.round(100 * (1 - Math.min(1, penalty / total)));
  const worst = c.worstVehicleScore;
  return worst === null || worst === undefined ? score : Math.min(score, worst);
}

/**
 * Legend class. A cell with no fixes but a loss alarm / gap is "poor" — the
 * tracker went blind there — while a cell with nothing at all is "none".
 */
export function coverageLevel(c: Parameters<typeof coverageScore>[0]): CoverageLevel {
  if (c.points === 0) return c.gaps + (c.lossAlarms ?? 0) > 0 ? 'poor' : 'none';
  const score = coverageScore(c);
  if (score >= 75) return 'good';
  if (score >= 45) return 'fair';
  return 'poor';
}

/**
 * Fold GPS-loss alarms into the coverage grid: each alarm lands in the cell of
 * its last known position (a new cell is created when the fleet left no fixes
 * there), and every touched cell is re-scored.
 */
export function mergeLossAlarms(
  cells: readonly CoverageCell[],
  alarms: readonly Pick<Alarm, 'lat' | 'lng'>[],
  cellMeters: number,
): CoverageCell[] {
  const step = cellMeters / METERS_PER_DEG;
  const key = (lat: number, lng: number) =>
    `${Math.floor(lat / step + 1e-9)}:${Math.floor(lng / step + 1e-9)}`;
  const byKey = new Map<string, CoverageCell>();
  for (const c of cells) byKey.set(key(c.lat, c.lng), { ...c, lossAlarms: c.lossAlarms ?? 0 });
  for (const a of alarms) {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng) || (a.lat === 0 && a.lng === 0))
      continue;
    const k = key(a.lat, a.lng);
    let cell = byKey.get(k);
    if (!cell) {
      const gy = Math.floor(a.lat / step);
      const gx = Math.floor(a.lng / step);
      const south = gy * step;
      const west = gx * step;
      cell = {
        south,
        west,
        north: south + step,
        east: west + step,
        lat: south + step / 2,
        lng: west + step / 2,
        points: 0,
        satPoints: 0,
        avgSatellites: null,
        weakPoints: 0,
        noFixPoints: 0,
        lowQualityPoints: 0,
        gaps: 0,
        vehicles: 0,
        score: 0,
        level: 'none',
        lossAlarms: 0,
      };
      byKey.set(k, cell);
    }
    cell.lossAlarms = (cell.lossAlarms ?? 0) + 1;
  }
  return [...byKey.values()].map((c) => ({
    ...c,
    score: coverageScore(c),
    level: coverageLevel(c),
  }));
}

export interface CoverageSummary {
  good: number;
  fair: number;
  poor: number;
  /** Share of cells (with data) that have good signal, 0..100. */
  goodShare: number;
  lossAlarms: number;
  gaps: number;
}

export function summarizeCoverage(cells: readonly CoverageCell[]): CoverageSummary {
  let good = 0;
  let fair = 0;
  let poor = 0;
  let lossAlarms = 0;
  let gaps = 0;
  for (const c of cells) {
    if (c.level === 'good') good++;
    else if (c.level === 'fair') fair++;
    else if (c.level === 'poor') poor++;
    lossAlarms += c.lossAlarms ?? 0;
    gaps += c.gaps;
  }
  const rated = good + fair + poor;
  return {
    good,
    fair,
    poor,
    goodShare: rated > 0 ? Math.round((good / rated) * 100) : 0,
    lossAlarms,
    gaps,
  };
}

/** Worst cells first (lowest score, then most problems). */
export function worstCells(cells: readonly CoverageCell[], limit = 8): CoverageCell[] {
  return cells
    .filter((c) => c.level === 'poor' || c.level === 'fair')
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.gaps + (b.lossAlarms ?? 0) - (a.gaps + (a.lossAlarms ?? 0)) ||
        b.points - a.points,
    )
    .slice(0, limit);
}

export interface MovementInsights {
  totalMovingSec: number;
  totalStoppedSec: number;
  /** moving / (moving + stopped), 0..100. */
  utilization: number;
  totalDistanceKm: number;
  activeVehicles: number;
  /** Hour of day (0..23) with the most driving, or null. */
  peakHour: number | null;
  /** Hour of day with the least driving among hours that have activity. */
  quietHour: number | null;
  /** Postgres DOW (0 = Sunday) with the most driving, or null. */
  busiestDay: number | null;
  /** Moving seconds per hour of day (24 slots). */
  byHour: { moving: number[]; stopped: number[] };
  /** [dow][hour] moving seconds. */
  matrix: number[][];
}

export function movementInsights(data: MovementResponse): MovementInsights {
  const moving = new Array<number>(24).fill(0);
  const stopped = new Array<number>(24).fill(0);
  const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const byDay = new Array<number>(7).fill(0);
  for (const h of data.hours) {
    if (h.hour < 0 || h.hour > 23 || h.dow < 0 || h.dow > 6) continue;
    moving[h.hour] += h.movingSec;
    stopped[h.hour] += h.stoppedSec;
    matrix[h.dow][h.hour] += h.movingSec;
    byDay[h.dow] += h.movingSec;
  }
  const argmax = (xs: number[]) => {
    let best = -1;
    let at: number | null = null;
    xs.forEach((v, i) => {
      if (v > best && v > 0) {
        best = v;
        at = i;
      }
    });
    return at;
  };
  let quietHour: number | null = null;
  let quiet = Number.POSITIVE_INFINITY;
  moving.forEach((v, i) => {
    if (v > 0 && v < quiet) {
      quiet = v;
      quietHour = i;
    }
  });
  const totalMovingSec = data.vehicles.reduce((s, v) => s + v.movingSec, 0);
  const totalStoppedSec = data.vehicles.reduce((s, v) => s + v.stoppedSec, 0);
  const total = totalMovingSec + totalStoppedSec;
  return {
    totalMovingSec,
    totalStoppedSec,
    utilization: total > 0 ? Math.round((totalMovingSec / total) * 100) : 0,
    totalDistanceKm: Math.round(data.vehicles.reduce((s, v) => s + v.distanceKm, 0) * 10) / 10,
    activeVehicles: data.vehicles.filter((v) => v.movingSec > 0).length,
    peakHour: argmax(moving),
    quietHour,
    busiestDay: argmax(byDay),
    byHour: { moving, stopped },
    matrix,
  };
}

/** Seconds → hours with one decimal. */
export function hoursOf(sec: number): number {
  return Math.round((sec / 3600) * 10) / 10;
}

/**
 * Share of the busiest cell, log-scaled so one hotspot does not wash the rest
 * of the grid out to the quiet color. 0 = no activity, 1 = the busiest cell.
 */
export function activityShare(weight: number, maxWeight: number): number {
  if (!(weight > 0) || !(maxWeight > 0)) return 0;
  return Math.min(1, Math.log1p(weight) / Math.log1p(maxWeight));
}

/**
 * Movement-legend ramp: quiet cyan (`#06B6D4`) → amber → busy red (`#F04438`).
 * `t` is 0..1 (see `activityShare`).
 */
export function activityColor(t: number): string {
  const x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const stops: Array<[number, [number, number, number]]> = [
    [0, [6, 182, 212]],
    [0.5, [253, 176, 34]],
    [1, [240, 68, 56]],
  ];
  let i = 0;
  while (i < stops.length - 2 && x > (stops[i + 1]?.[0] ?? 1)) i++;
  const left = stops[i] ?? stops[0];
  const right = stops[i + 1] ?? stops[stops.length - 1];
  if (!left || !right) return 'rgb(6, 182, 212)';
  const [t0, c0] = left;
  const [t1, c1] = right;
  const u = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
  const ch = (a: number, b: number) => Math.round(a + (b - a) * u);
  return `rgb(${ch(c0[0], c1[0])}, ${ch(c0[1], c1[1])}, ${ch(c0[2], c1[2])})`;
}

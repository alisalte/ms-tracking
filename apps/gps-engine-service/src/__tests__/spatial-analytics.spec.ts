import { describe, expect, it, jest } from '@jest/globals';
import { AnalyticsController, resolveTimeZone } from '../api/analytics.controller.js';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import {
  cellBounds,
  cellStepDeg,
  clampCellMeters,
  convexHull,
  coverageLevel,
  coverageScore,
  polygonAreaKm2,
  projectArea,
} from '../domain/spatial-analytics.js';
import type { PositionAnalyticsRepository } from '../infrastructure/persistence/position-analytics.repository.js';

const clean = {
  points: 100,
  satPoints: 100,
  avgSatellites: 11,
  weakPoints: 0,
  noFixPoints: 0,
  lowQualityPoints: 0,
  gaps: 0,
};

describe('coverage scoring', () => {
  it('scores a clean cell 100 / good', () => {
    expect(coverageScore(clean)).toBe(100);
    expect(coverageLevel(clean)).toBe('good');
  });

  it('marks a cell with frequent no-fix and gaps as poor', () => {
    const bad = { ...clean, points: 20, noFixPoints: 8, weakPoints: 6, gaps: 3 };
    expect(coverageScore(bad)).toBeLessThan(45);
    expect(coverageLevel(bad)).toBe('poor');
  });

  it('counts GPS-loss alarms like gaps', () => {
    const base = { ...clean, points: 30 };
    expect(coverageScore({ ...base, lossAlarms: 4 })).toBeLessThan(coverageScore(base));
  });

  it('reports a gap-only cell (no fixes) as none', () => {
    expect(coverageLevel({ ...clean, points: 0, satPoints: 0, gaps: 2 })).toBe('none');
  });
});

describe('grid helpers', () => {
  it('clamps cell sizes and defaults garbage', () => {
    expect(clampCellMeters('10')).toBe(50);
    expect(clampCellMeters('99999')).toBe(5000);
    expect(clampCellMeters('abc')).toBe(250);
    expect(clampCellMeters(undefined)).toBe(250);
  });

  it('derives cell bounds that contain the centre', () => {
    const step = cellStepDeg(250);
    const b = cellBounds(Math.floor(35.7 / step), Math.floor(51.4 / step), step);
    expect(b.south).toBeLessThanOrEqual(35.7);
    expect(b.north).toBeGreaterThan(35.7);
    expect(b.lat).toBeGreaterThan(b.south);
    expect(b.lng).toBeLessThan(b.east);
  });
});

describe('project area', () => {
  it('builds a convex hull and drops interior points', () => {
    const hull = convexHull([
      { lng: 0, lat: 0 },
      { lng: 1, lat: 0 },
      { lng: 1, lat: 1 },
      { lng: 0, lat: 1 },
      { lng: 0.5, lat: 0.5 },
    ]);
    expect(hull).toHaveLength(4);
  });

  it('computes an area close to 1 km² for a 1 km square', () => {
    const d = 1000 / 111_320;
    const ring = [
      { lng: 0, lat: 0 },
      { lng: d, lat: 0 },
      { lng: d, lat: d },
      { lng: 0, lat: d },
    ];
    expect(polygonAreaKm2(ring)).toBeCloseTo(1, 2);
  });

  it('ignores rare outlier cells when wrapping the working area', () => {
    const step = cellStepDeg(250);
    const cells = [
      { gy: 0, gx: 0, weight: 500 },
      { gy: 0, gx: 1, weight: 500 },
      { gy: 1, gx: 0, weight: 500 },
      { gy: 1, gx: 1, weight: 500 },
      { gy: 400, gx: 400, weight: 1 },
    ];
    const area = projectArea(cells, step);
    expect(area.cellCount).toBe(4);
    expect(area.bbox?.north).toBeLessThan(400 * step);
    expect(area.areaKm2).toBeGreaterThan(0.2);
  });

  it('returns an empty area without activity', () => {
    expect(projectArea([], 0.01)).toMatchObject({ hull: [], areaKm2: 0, bbox: null });
  });
});

describe('AnalyticsController', () => {
  const config = { HISTORY_MAX_RANGE_DAYS: 31 } as GpsEngineConfig;

  function repo(): jest.Mocked<PositionAnalyticsRepository> {
    return {
      coverageCells: jest.fn(async () => [
        { gy: 1, gx: 2, ...clean, vehicles: 2 },
        { gy: 1, gx: 3, ...clean, points: 10, noFixPoints: 9, vehicles: 1 },
      ]),
      movementCells: jest.fn(async () => [
        {
          gy: 1,
          gx: 2,
          points: 50,
          movingSec: 600,
          stoppedSec: 3000,
          vehicles: 1,
          avgMovingKph: 30,
          maxKph: 60,
        },
      ]),
      hourBuckets: jest.fn(async () => []),
      vehicleSummaries: jest.fn(async () => []),
    } as unknown as jest.Mocked<PositionAnalyticsRepository>;
  }

  it('scores coverage cells and totals the levels', async () => {
    const r = repo();
    const ctl = new AnalyticsController(r, config);
    const res = await ctl.gpsCoverage('tenant', '7d');
    expect(res.cells.map((c) => c.level)).toEqual(['good', 'poor']);
    expect(res.totals).toMatchObject({ good: 1, poor: 1, points: 110 });
    expect(r.coverageCells.mock.calls[0]?.[0].tenantId).toBe('tenant');
  });

  it('returns the project area and stop hotspots for movement', async () => {
    const ctl = new AnalyticsController(repo(), config);
    const res = await ctl.movement('tenant', '24h');
    expect(res.area.cellCount).toBe(1);
    expect(res.stopHotspots).toHaveLength(1);
    expect(res.timeZone).toBe('Asia/Tehran');
  });

  it('rejects a malformed vehicle id and a bad window', async () => {
    const ctl = new AnalyticsController(repo(), config);
    await expect(
      ctl.gpsCoverage('tenant', '7d', undefined, undefined, undefined, 'x'),
    ).rejects.toThrow('vehicleId must be a UUID');
    await expect(ctl.gpsCoverage('tenant', '7d', '2026-01-01T00:00:00Z')).rejects.toThrow();
  });

  it('only accepts IANA time zones', () => {
    expect(resolveTimeZone(undefined)).toBe('Asia/Tehran');
    expect(resolveTimeZone('UTC')).toBe('UTC');
    expect(() => resolveTimeZone("UTC'; drop table x;--")).toThrow();
  });
});

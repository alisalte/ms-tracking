import { describe, expect, it } from 'vitest';

import type { CoverageCell, MovementResponse } from '@/api/analytics.api';
import { isGpsLossAlarm } from '@/api/analytics.api';
import {
  coverageLevel,
  coverageScore,
  mergeLossAlarms,
  movementInsights,
  summarizeCoverage,
  worstCells,
} from '@/lib/spatial-analytics';

const STEP = 250 / 111_320;

function cell(gy: number, gx: number, over: Partial<CoverageCell> = {}): CoverageCell {
  const south = gy * STEP;
  const west = gx * STEP;
  const base = {
    south,
    west,
    north: south + STEP,
    east: west + STEP,
    lat: south + STEP / 2,
    lng: west + STEP / 2,
    points: 50,
    satPoints: 50,
    avgSatellites: 10,
    weakPoints: 0,
    noFixPoints: 0,
    lowQualityPoints: 0,
    gaps: 0,
    vehicles: 2,
    score: 100,
    level: 'good' as const,
    ...over,
  };
  return { ...base, score: coverageScore(base), level: coverageLevel(base) };
}

describe('coverage scoring (client mirror)', () => {
  it('matches the server classes', () => {
    expect(coverageLevel(cell(1, 1))).toBe('good');
    expect(coverageLevel(cell(1, 1, { points: 10, noFixPoints: 8, gaps: 2 }))).toBe('poor');
    expect(coverageLevel(cell(1, 1, { points: 0, gaps: 0 }))).toBe('none');
  });

  it('folds GPS-loss alarms into the cell they fell in', () => {
    const c = cell(14_300, 20_560);
    const merged = mergeLossAlarms(
      [c],
      [
        { lat: c.lat, lng: c.lng },
        { lat: c.lat, lng: c.lng },
      ],
      250,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.lossAlarms).toBe(2);
    expect(merged[0]?.score).toBeLessThan(c.score);
  });

  it('creates a poor cell where an alarm fired without any fixes', () => {
    const c = cell(14_300, 20_560);
    const far = { lat: c.lat + 0.05, lng: c.lng + 0.05 };
    const merged = mergeLossAlarms([c], [far], 250);
    expect(merged).toHaveLength(2);
    const created = merged.find((m) => m.points === 0);
    expect(created?.level).toBe('poor');
    expect(created && far.lat >= created.south && far.lat < created.north).toBe(true);
  });

  it('summarizes and ranks the weakest places', () => {
    const cells = [
      cell(1, 1),
      cell(1, 2, { points: 20, weakPoints: 10, gaps: 1 }),
      cell(1, 3, { points: 10, noFixPoints: 9, gaps: 3 }),
    ];
    const s = summarizeCoverage(cells);
    expect(s.good + s.fair + s.poor).toBe(3);
    expect(worstCells(cells)[0]?.score).toBe(Math.min(...cells.map((c) => c.score)));
  });

  it('recognizes GPS-loss alarms', () => {
    expect(isGpsLossAlarm({ code: 'GPS_SIGNAL_LOST', type: 'other' })).toBe(true);
    expect(isGpsLossAlarm({ code: undefined, type: 'jamming' })).toBe(true);
    expect(isGpsLossAlarm({ code: 'SOS', type: 'sos' })).toBe(false);
  });
});

describe('movementInsights', () => {
  const data: MovementResponse = {
    from: '',
    to: '',
    cellMeters: 250,
    timeZone: 'Asia/Tehran',
    area: { hull: [], areaKm2: 3, bbox: null, coverage: 0.95, cellCount: 4 },
    cells: [],
    stopHotspots: [],
    hours: [
      { dow: 6, hour: 8, movingSec: 7200, stoppedSec: 600, vehicles: 2 },
      { dow: 0, hour: 8, movingSec: 3600, stoppedSec: 600, vehicles: 2 },
      { dow: 0, hour: 22, movingSec: 600, stoppedSec: 3000, vehicles: 1 },
    ],
    vehicles: [
      {
        vehicleId: 'a',
        points: 10,
        distanceKm: 40.25,
        movingSec: 9000,
        stoppedSec: 3000,
        maxKph: 70,
        avgMovingKph: 30,
        activeDays: 2,
        cells: 5,
        firstSeen: '',
        lastSeen: '',
      },
      {
        vehicleId: 'b',
        points: 4,
        distanceKm: 0,
        movingSec: 0,
        stoppedSec: 1200,
        maxKph: 0,
        avgMovingKph: null,
        activeDays: 1,
        cells: 1,
        firstSeen: '',
        lastSeen: '',
      },
    ],
  };

  it('finds the peak hour, busiest day and utilization', () => {
    const i = movementInsights(data);
    expect(i.peakHour).toBe(8);
    expect(i.quietHour).toBe(22);
    expect(i.busiestDay).toBe(6);
    expect(i.activeVehicles).toBe(1);
    expect(i.utilization).toBe(Math.round((9000 / 13_200) * 100));
    expect(i.totalDistanceKm).toBe(40.3);
    expect(i.matrix[6]?.[8]).toBe(7200);
  });
});

describe('worst-vehicle score cap', () => {
  const busyClean = {
    points: 1008,
    weakPoints: 8,
    noFixPoints: 0,
    lowQualityPoints: 0,
    gaps: 0,
  };

  it('is rosy when only the fleet aggregate is used', () => {
    expect(coverageScore(busyClean)).toBeGreaterThanOrEqual(99);
  });

  it('is capped by the worst single vehicle so busy clean traffic cannot hide a dead spot', () => {
    const cell = { ...busyClean, worstVehicleScore: 40 };
    expect(coverageScore(cell)).toBe(40);
    expect(coverageLevel(cell)).toBe('poor');
  });

  it('ignores a missing worst score', () => {
    expect(coverageScore({ ...busyClean, worstVehicleScore: null })).toBe(coverageScore(busyClean));
  });
});

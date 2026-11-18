import { describe, expect, it } from '@jest/globals';
import {
  type MileageVehicleRow,
  buildMileageReport,
  fleetOverspeedEpisodes,
  formatDuration,
  mileageSheet,
  overspeedSheet,
  parseTemperatureBounds,
  sensorLabel,
  temperatureSheet,
} from '../domain/fleet-reports.js';
import type { SpeedFix } from '../domain/speeding-events.js';

const t0 = Date.parse('2026-08-31T03:00:00Z');
const fix = (sec: number, speedKmh: number, lat = 35.6): SpeedFix => ({
  at: new Date(t0 + sec * 1000),
  lat: lat + sec / 100_000,
  lng: 51.4,
  speedKmh,
});

describe('fleetOverspeedEpisodes', () => {
  const vehicles = [
    { vehicleId: 'b', label: 'T 68-121', fleetName: null },
    { vehicleId: 'a', label: 'T 15-366', fleetName: 'North' },
    { vehicleId: 'c', label: 'T 91-396', fleetName: null },
  ];

  it('numbers episodes per vehicle and orders vehicles by label', () => {
    const fixes = new Map<string, SpeedFix[]>([
      ['b', [fix(0, 95), fix(10, 98), fix(600, 96), fix(620, 97)]],
      ['a', [fix(0, 94), fix(30, 95)]],
    ]);
    const { rows } = fleetOverspeedEpisodes(vehicles, fixes, new Map(), {
      limitKmh: 90,
      minDurationSec: 0,
    });
    expect(rows.map((r) => [r.label, r.seq])).toEqual([
      ['T 15-366', 1],
      ['T 68-121', 1],
      ['T 68-121', 2],
    ]);
    const first = rows[1];
    expect(first?.maxSpeedKmh).toBe(98);
    expect(first?.durationSec).toBe(10);
    expect(first?.peak.at).toBe(new Date(t0 + 10_000).toISOString());
  });

  it('drops runs shorter than the minimum duration and renumbers', () => {
    const fixes = new Map<string, SpeedFix[]>([
      ['b', [fix(0, 95), fix(5, 96), fix(600, 96), fix(700, 97), fix(780, 99)]],
    ]);
    const { rows } = fleetOverspeedEpisodes(vehicles, fixes, new Map(), {
      limitKmh: 90,
      minDurationSec: 60,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seq).toBe(1);
    expect(rows[0]?.durationSec).toBe(180);
  });

  it('never invents an episode for a vehicle without over-limit fixes', () => {
    const { rows } = fleetOverspeedEpisodes(vehicles, new Map(), new Map(), {
      limitKmh: 90,
      minDurationSec: 0,
    });
    expect(rows).toEqual([]);
  });
});

describe('buildMileageReport', () => {
  const row = (
    vehicleId: string,
    fleetId: string | null,
    fleetName: string | null,
    km: number,
  ): MileageVehicleRow => ({
    vehicleId,
    label: `T ${vehicleId}`,
    fleetId,
    fleetName,
    distanceKm: km,
    trips: km > 0 ? 1 : 0,
  });
  const rows = [
    row('15-612', 'f2', 'South', 1703.561),
    row('15-222', 'f1', 'North', 3251.33),
    row('15-512', null, null, 92.3),
    row('15-999', 'f1', 'North', 0),
  ];

  it('groups by fleet with subtotals and a grand total, "no fleet" last', () => {
    const r = buildMileageReport(rows, { hideZero: false });
    expect(r.groups.map((g) => g.fleetName)).toEqual(['North', 'South', null]);
    expect(r.groups[0]?.subtotalKm).toBe(3251.33);
    expect(r.groups[1]?.rows[0]?.distanceKm).toBe(1703.56);
    expect(r.totalKm).toBe(5047.19);
    expect(r.vehicleCount).toBe(4);
    expect(r.hiddenZeroCount).toBe(0);
  });

  it('can hide vehicles that did not move', () => {
    const r = buildMileageReport(rows, { hideZero: true });
    expect(r.vehicleCount).toBe(3);
    expect(r.hiddenZeroCount).toBe(1);
    expect(r.groups[0]?.rows.map((x) => x.vehicleId)).toEqual(['15-222']);
  });
});

describe('parseTemperatureBounds', () => {
  it('accepts one or both sides', () => {
    expect(parseTemperatureBounds(undefined, '16')).toEqual({ bounds: { minC: null, maxC: 16 } });
    expect(parseTemperatureBounds('-18', '-12')).toEqual({ bounds: { minC: -18, maxC: -12 } });
  });

  it('rejects a missing, reversed or garbage band', () => {
    expect(parseTemperatureBounds('', undefined)).toEqual({ error: 'MISSING' });
    expect(parseTemperatureBounds('8', '2')).toEqual({ error: 'REVERSED' });
    expect(parseTemperatureBounds('abc', '2')).toEqual({ error: 'INVALID' });
  });
});

describe('formatting', () => {
  it('words a duration like the legacy report', () => {
    expect(formatDuration(248, 'fa')).toBe('4 دقیقه 8 ثانیه');
    expect(formatDuration(8460, 'fa')).toBe('2 ساعت 21 دقیقه 0 ثانیه');
    expect(formatDuration(8460, 'en')).toBe('2h 21m 0s');
  });

  it('names probes', () => {
    expect(sensorLabel('temp1')).toBe('T1');
    expect(sensorLabel('cce3')).toBe('T3');
    expect(sensorLabel('lls2Temp')).toBe('LLS2');
  });
});

describe('sheets', () => {
  const win = { from: new Date('2026-08-31T20:30:00Z'), to: new Date('2026-09-01T19:30:00Z') };

  it('lays out the high-speed sheet with Shamsi dates', () => {
    const sheet = overspeedSheet(
      [
        {
          vehicleId: 'a',
          label: 'T 68-121',
          fleetName: null,
          seq: 1,
          startedAt: '2026-09-01T03:24:50Z',
          endedAt: '2026-09-01T03:28:58Z',
          durationSec: 248,
          maxSpeedKmh: 98,
          avgSpeedKmh: 95.2,
          fixCount: 12,
          peak: { at: '2026-09-01T03:26:00Z', lat: 35.5, lng: 51.7 },
        },
      ],
      win,
      90,
      'fa',
    );
    expect(sheet.rtl).toBe(true);
    expect(sheet.rows[1]?.[1]).toBe('1405/06/10 00:00:00 - 1405/06/10 23:00:00');
    expect(sheet.rows[5]).toEqual([
      1,
      'T 68-121',
      '1405/06/10',
      '06:54:50',
      '1405/06/10',
      '06:58:58',
      '4 دقیقه 8 ثانیه',
      248,
      98,
      95.2,
      35.5,
      51.7,
    ]);
  });

  it('ends the mileage sheet with subtotals and the grand total', () => {
    const report = buildMileageReport(
      [
        { vehicleId: '1', label: 'A', fleetId: 'f1', fleetName: 'F1', distanceKm: 10, trips: 1 },
        { vehicleId: '2', label: 'B', fleetId: 'f2', fleetName: 'F2', distanceKm: 5.5, trips: 2 },
      ],
      { hideZero: false },
    );
    const rows = mileageSheet(report, win, 'en').rows;
    expect(rows.at(-1)).toEqual(['', 'Grand total', '', '', '', 15.5, '']);
    expect(rows.filter((r) => String(r[1]).startsWith('Fleet subtotal'))).toHaveLength(2);
  });

  it('prints the allowed band on the temperature sheet', () => {
    const sheet = temperatureSheet([], win, { minC: null, maxC: 16 }, 'fa');
    expect(sheet.rows[2]).toEqual(['بازهٔ مجاز (°C)', '-∞ … 16']);
  });
});

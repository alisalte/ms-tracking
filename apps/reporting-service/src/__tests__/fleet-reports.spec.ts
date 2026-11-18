import { describe, expect, it } from '@jest/globals';
import {
  type MileageVehicleRow,
  buildMileageReport,
  fleetOverspeedEpisodes,
  formatDuration,
  fuelSheet,
  mileageSheet,
  objectCells,
  objectsHeader,
  overspeedSheet,
  parseTemperatureBounds,
  sensorLabel,
  temperatureSheet,
} from '../domain/fleet-reports.js';
import {
  analogTemperatureEpisodes,
  buildFuelEvents,
  calibrateVolts,
  parseIoSensors,
} from '../domain/sensor-reports.js';
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

describe('objects list', () => {
  it('keeps the legacy column order and Shamsi times in fa', () => {
    expect(objectsHeader('fa')).toHaveLength(17);
    expect(objectsHeader('fa')[0]).toBe('نام');
    expect(objectsHeader('fa')[16]).toBe('آخرین زمان ارسال سرور');
    const cells = objectCells(
      {
        vehicleId: 'v',
        name: 'T 15-612 izst',
        imei: '350424065844621',
        plate: null,
        fleetName: 'پخش تهران',
        model: 'FMB120',
        vin: null,
        simNumber: '+989018237131',
        active: true,
        lat: 35.834658,
        lng: 50.94997,
        speedKmh: 0,
        altitudeM: 1319,
        headingDeg: 86,
        odometerKm: 19121.6,
        engineHours: null,
        lastFixAt: '2026-08-20T05:18:30Z',
        lastReceivedAt: '2026-08-20T05:18:32Z',
        connection: 'ONLINE',
      },
      'fa',
    );
    expect(cells).toEqual([
      'T 15-612 izst',
      '350424065844621',
      '',
      'پخش تهران',
      'FMB120',
      '',
      '+989018237131',
      1,
      35.834658,
      50.94997,
      0,
      1319,
      86,
      19121.6,
      '',
      '1405/05/29 08:48:30',
      '1405/05/29 08:48:32',
    ]);
  });
});

describe('analog sensors', () => {
  const points = [
    { v: 0, value: 0 },
    { v: 10, value: 100 },
  ];

  it('calibrates piecewise linearly and holds the calibrated ends', () => {
    expect(calibrateVolts(points, 5)).toBe(50);
    expect(calibrateVolts(points, -1)).toBe(0);
    expect(calibrateVolts(points, 12)).toBe(100);
    expect(calibrateVolts([], 5)).toBeNull();
  });

  it('keeps only well-formed io_sensors entries', () => {
    expect(
      parseIoSensors([
        { input: 'ain1', kind: 'temperature', label: 'Fridge', points },
        { input: 'ain2', kind: 'fuel', tankLiters: 500, points },
        { input: 'ain3', kind: 'nope', points },
        { input: 'ain4', kind: 'fuel', points: [{ v: 0, value: 0 }] },
      ]),
    ).toEqual([
      { input: 'ain1', kind: 'temperature', label: 'Fridge', tankLiters: null, points },
      { input: 'ain2', kind: 'fuel', label: null, tankLiters: 500, points },
    ]);
  });

  it('turns analog volts into out-of-range temperature periods', () => {
    const config = [
      {
        input: 'ain1',
        kind: 'temperature',
        label: 'دمای یخچال',
        points: [
          { v: 0, value: 0 },
          { v: 10, value: 20 },
        ],
      },
    ];
    const row = (min: number, volts: number) => ({
      vehicleId: 'v1',
      at: new Date(t0 + min * 60_000),
      lat: 35.6,
      lng: 51.4,
      analog: { ain1: volts },
      ioSensors: config,
    });
    const result = analogTemperatureEpisodes(
      [row(0, 7.5), row(1, 8.5), row(2, 9), row(3, 7.5)],
      { minC: null, maxC: 16 },
      0,
    );
    expect(result.sensors).toEqual([
      {
        vehicleId: 'v1',
        sensor: 'ain1',
        sensorLabel: 'دمای یخچال',
        readings: 4,
        minC: 15,
        maxC: 18,
      },
    ]);
    expect(result.episodes).toHaveLength(1);
    const episode = result.episodes[0];
    expect(episode?.kind).toBe('HIGH');
    expect(episode?.startedAt).toEqual(new Date(t0 + 60_000));
    expect(episode?.endedAt).toEqual(new Date(t0 + 3 * 60_000));
    expect([episode?.minC, episode?.maxC, episode?.avgC, episode?.readings]).toEqual([
      17, 18, 17.5, 2,
    ]);
  });
});

describe('buildFuelEvents', () => {
  const config = [
    {
      input: 'ain2',
      kind: 'fuel',
      label: 'باک اصلی',
      tankLiters: 500,
      points: [
        { v: 0, value: 0 },
        { v: 10, value: 100 },
      ],
    },
  ];
  const row = (min: number, volts: number) => ({
    vehicleId: 'v1',
    at: new Date(t0 + min * 60_000),
    lat: 35.6,
    lng: 51.4,
    analog: { ain2: volts },
    fuel: null,
    cceFuelPct: null,
    ioSensors: config,
  });

  it('reports a refill and an abnormal drop in percent and litres', () => {
    const { events, sensors } = buildFuelEvents(
      [row(0, 5), row(2, 5.1), row(4, 7), row(6, 4), row(20, 4.1)],
      { minDeltaPct: 8 },
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'FILL',
      startPct: 50,
      endPct: 70,
      deltaPct: 20,
      deltaL: 100,
      sensorLabel: 'باک اصلی',
    });
    expect(events[0]?.startedAt).toEqual(new Date(t0));
    expect(events[0]?.endedAt).toEqual(new Date(t0 + 4 * 60_000));
    expect(events[1]).toMatchObject({ kind: 'DROP', deltaPct: -30, deltaL: -150 });
    expect(sensors).toEqual([
      {
        vehicleId: 'v1',
        sensor: 'ain2',
        sensorLabel: 'باک اصلی',
        readings: 5,
        minPct: 40,
        maxPct: 70,
        lastPct: 41,
      },
    ]);
  });

  it('ignores normal consumption and readings across a long gap', () => {
    const { events } = buildFuelEvents([row(0, 5), row(5, 4.95), row(10, 4.9), row(60, 4.5)], {
      minDeltaPct: 8,
    });
    expect(events).toEqual([]);
  });

  it('uses the CAN and CCE percentages when there is no analog sender', () => {
    const base = {
      vehicleId: 'v2',
      lat: 35.6,
      lng: 51.4,
      analog: null,
      ioSensors: null,
    };
    const { events, sensors } = buildFuelEvents(
      [
        { ...base, at: new Date(t0), fuel: { canFuelLevelPct: 30 }, cceFuelPct: null },
        { ...base, at: new Date(t0 + 60_000), fuel: { canFuelLevelPct: 55 }, cceFuelPct: 25 },
        { ...base, at: new Date(t0 + 120_000), fuel: { canFuelLevelPct: 55 }, cceFuelPct: 25 },
      ],
      { minDeltaPct: 10 },
    );
    expect(events.map((e) => [e.sensor, e.kind, e.deltaPct])).toEqual([
      ['canFuelLevelPct', 'FILL', 25],
    ]);
    expect(sensors.map((s) => s.sensor).sort()).toEqual(['canFuelLevelPct', 'cceFuel']);
  });
});

describe('fuel sheet', () => {
  it('lays out a refill with its start and end level', () => {
    const sheet = fuelSheet(
      [
        {
          vehicleId: 'v',
          label: 'T 15-612',
          fleetName: null,
          sensor: 'ain2',
          sensorLabel: 'باک اصلی',
          seq: 1,
          kind: 'FILL',
          startedAt: '2026-09-01T03:00:00Z',
          endedAt: '2026-09-01T03:04:00Z',
          startPct: 50,
          endPct: 70,
          deltaPct: 20,
          deltaL: 100,
          start: { lat: 35.6, lng: 51.4 },
        },
      ],
      { from: new Date('2026-08-31T20:30:00Z'), to: new Date('2026-09-01T19:30:00Z') },
      8,
      'fa',
    );
    expect(sheet.rows[2]).toEqual(['حداقل تغییر (%)', 8]);
    expect(sheet.rows[5]).toEqual([
      1,
      'T 15-612',
      'باک اصلی',
      'سوخت‌گیری',
      '1405/06/10',
      '06:30:00',
      '1405/06/10',
      '06:34:00',
      50,
      70,
      20,
      100,
      35.6,
      51.4,
    ]);
  });
});

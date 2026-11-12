import { describe, expect, it } from '@jest/globals';
import type { HaulCycle, TrackSample } from '../domain/haul-cycles.js';
import { haulShiftSheets } from '../domain/haul-shifts-workbook.js';
import {
  type PlanRoute,
  measureShiftWork,
  planCycles,
  shiftPlan,
  shiftResolver,
  summarizeShiftReport,
} from '../domain/haul-shifts.js';

const TZ = 'Asia/Tehran';

function route(
  routeId: string,
  startHour: number,
  durationHours: number,
  shiftCount: number,
  roster: Array<{ driverId: string; driverName: string } | null>,
): PlanRoute {
  return {
    routeId,
    routeName: routeId,
    ctx: {
      drivers: [],
      rosters: new Map([['v1', roster]]),
      shiftStartHour: startHour,
      shiftDurationHours: durationHours,
      shiftCount,
      timeZone: TZ,
    },
  };
}

const ali = { driverId: 'd1', driverName: 'Ali' };
const reza = { driverId: 'd2', driverName: 'Reza' };

/** One route, two 12-hour shifts from 06:00 Tehran (02:30 UTC): day 06–18, night 18–06. */
function oneRoute() {
  const routes = [route('r1', 6, 12, 2, [ali, reza])];
  const plan = shiftPlan(routes);
  return { plan, resolve: shiftResolver(routes, plan, TZ) };
}

/** Two routes on the same trucks: day 07:00 for 12 h, night 19:00 for 9 h (to 04:00). */
function dayAndNightRoutes() {
  const routes = [route('night', 19, 9, 1, [reza]), route('day', 7, 12, 1, [ali])];
  const plan = shiftPlan(routes);
  return { plan, resolve: shiftResolver(routes, plan, TZ) };
}

/** One fix a minute from `start` (UTC), `count` fixes, heading north at `kmh`. */
function track(start: string, count: number, kmh: number, ignitionOn: boolean): TrackSample[] {
  const t0 = new Date(start).getTime();
  const step = (kmh / 3.6) * 60; // metres per minute
  return Array.from({ length: count }, (_, i) => ({
    at: new Date(t0 + i * 60_000),
    lat: 30 + (i * step) / 111_320,
    lng: 55,
    speedKmh: kmh,
    ignitionOn,
  }));
}

function cycle(over: Partial<HaulCycle>): HaulCycle {
  const at = new Date('2026-10-21T06:30:00Z');
  return {
    vehicleId: 'v1',
    shovelId: null,
    driverId: 'd1',
    driverName: 'Ali',
    driverSource: 'ROSTER',
    originEnteredAt: at,
    originLeftAt: at,
    destinationEnteredAt: at,
    loadDwellSec: 60,
    travelSec: 120,
    durationSec: 180,
    distanceM: 2000,
    shift: '2026-10-21#1',
    shiftDate: '2026-10-21',
    loadPoint: { lat: 0, lng: 0 },
    dumpPoint: { lat: 0, lng: 0 },
    shiftNo: 1,
    ...over,
  };
}

describe('haul shift work', () => {
  it('splits working time and distance by shift and driver', () => {
    const { resolve } = oneRoute();
    const samples = [
      // Day shift, 10:00 local: 10 minutes driving at 30 km/h.
      ...track('2026-10-21T06:30:00Z', 11, 30, true),
      // Day shift: 10 minutes parked with the engine off — not work.
      ...track('2026-10-21T07:00:00Z', 11, 0, false),
      // Night shift, 01:00 local next day: 5 minutes standing, engine on.
      ...track('2026-10-21T21:30:00Z', 6, 0, true),
    ];
    const slices = measureShiftWork({ vehicleId: 'v1', samples, resolve });
    const day = slices.find((s) => s.shiftNo === 1);
    const night = slices.find((s) => s.shiftNo === 2);
    expect(day).toMatchObject({
      day: '2026-10-21',
      driverName: 'Ali',
      workSec: 600,
      movingSec: 600,
    });
    expect(day?.distanceM).toBeGreaterThan(4900);
    expect(day?.distanceM).toBeLessThan(5100);
    // The night shift after midnight still belongs to the work day it started on.
    expect(night).toMatchObject({
      day: '2026-10-21',
      driverName: 'Reza',
      workSec: 300,
      movingSec: 0,
    });
    expect(night?.distanceM).toBe(0);
  });

  it('does not count gaps without data', () => {
    const { resolve } = oneRoute();
    const samples = [
      ...track('2026-10-21T06:30:00Z', 2, 30, true),
      ...track('2026-10-21T07:30:00Z', 2, 30, true),
    ];
    const slices = measureShiftWork({ vehicleId: 'v1', samples, resolve });
    expect(slices.reduce((sum, s) => sum + s.workSec, 0)).toBe(120);
  });

  it('names a 12-hour pair day and night, but not other layouts', () => {
    const kinds = (routes: PlanRoute[]) => shiftPlan(routes).map((s) => s.kind);
    expect(kinds([route('r', 6, 12, 2, [])])).toEqual(['day', 'night']);
    expect(kinds([route('r', 18, 12, 2, [])])).toEqual(['night', 'day']);
    expect(kinds([route('r', 6, 8, 2, [])])).toEqual([null, null]);
    expect(kinds([route('r', 6, 8, 3, [])])).toEqual([null, null, null]);
  });

  it('reads a day route and a night route as one work day', () => {
    const { plan, resolve } = dayAndNightRoutes();
    // The day route starts the work day even when listed second.
    expect(plan.map((s) => [s.no, s.routeId, s.kind])).toEqual([
      [1, 'day', 'day'],
      [2, 'night', 'night'],
    ]);
    // 10:00, 23:00 and 02:00 (next day) local; 05:00 is in neither route.
    expect(resolve('v1', new Date('2026-10-21T06:30:00Z'))).toMatchObject({
      day: '2026-10-21',
      shiftNo: 1,
      driver: ali,
    });
    expect(resolve('v1', new Date('2026-10-21T19:30:00Z'))).toMatchObject({
      day: '2026-10-21',
      shiftNo: 2,
      driver: reza,
    });
    expect(resolve('v1', new Date('2026-10-21T22:30:00Z'))).toMatchObject({
      day: '2026-10-21',
      shiftNo: 2,
    });
    expect(resolve('v1', new Date('2026-10-22T01:30:00Z'))).toMatchObject({
      day: '2026-10-22',
      shiftNo: 0,
    });
  });

  it('counts a service found on both routes once, in the shift it ran', () => {
    const { resolve } = dayAndNightRoutes();
    const night = new Date('2026-10-21T19:30:00Z');
    const seenByDayRoute = cycle({
      originEnteredAt: night,
      driverId: null,
      driverName: null,
      shift: 'off-shift',
      shiftDate: null,
      shiftNo: 0,
    });
    const seenByNightRoute = cycle({ originEnteredAt: night, driverId: 'd2', driverName: 'Reza' });
    const merged = planCycles([seenByDayRoute, seenByNightRoute, cycle({})], resolve);
    expect(merged.map((c) => [c.shiftNo, c.driverName])).toEqual([
      [1, 'Ali'],
      [2, 'Reza'],
    ]);
  });

  it("splits one truck's day across the day and night routes without double counting", () => {
    const { resolve } = dayAndNightRoutes();
    const samples = [
      ...track('2026-10-21T06:30:00Z', 11, 30, true), // 10:00 local, day route
      ...track('2026-10-21T19:30:00Z', 11, 30, true), // 23:00 local, night route
      ...track('2026-10-22T01:30:00Z', 11, 30, true), // 05:00 local, neither
    ];
    const slices = measureShiftWork({ vehicleId: 'v1', samples, resolve });
    expect(slices.map((s) => [s.shiftNo, s.driverName, s.workSec])).toEqual([
      [1, 'Ali', 600],
      [2, 'Reza', 600],
      [0, null, 600],
    ]);
  });

  it('rolls up trucks per shift and drivers per day and month', () => {
    const work = [
      {
        vehicleId: 'v1',
        day: '2026-10-21',
        shiftNo: 1,
        driverId: 'd1',
        driverName: 'Ali',
        workSec: 3600,
        movingSec: 1800,
        distanceM: 20_000,
      },
      {
        vehicleId: 'v2',
        day: '2026-10-23',
        shiftNo: 2,
        driverId: 'd1',
        driverName: 'Ali',
        workSec: 7200,
        movingSec: 3600,
        distanceM: 30_000,
      },
      // Too short to count as having worked on v3.
      {
        vehicleId: 'v3',
        day: '2026-10-23',
        shiftNo: 2,
        driverId: 'd1',
        driverName: 'Ali',
        workSec: 60,
        movingSec: 0,
        distanceM: 0,
      },
    ];
    const cycles = [
      cycle({}),
      cycle({}),
      cycle({ vehicleId: 'v2', shiftDate: '2026-10-23', shiftNo: 2, shift: '2026-10-23#2' }),
    ];
    const report = summarizeShiftReport({ cycles, work, timeZone: TZ });

    expect(report.trucks.find((r) => r.vehicleId === 'v1')).toMatchObject({
      day: '2026-10-21',
      shiftNo: 1,
      services: 2,
      workSec: 3600,
      driverNames: ['Ali'],
    });
    const ali = report.drivers[0];
    expect(ali).toMatchObject({
      driverName: 'Ali',
      services: 3,
      workSec: 3600 + 7200 + 60,
      days: 2,
      shifts: 2,
      servicesByShift: { 1: 2, 2: 1 },
    });
    expect(ali?.vehicleIds.sort()).toEqual(['v1', 'v2']);
    expect(report.driverDays.map((r) => r.period)).toEqual(['2026-10-21', '2026-10-23']);
    // 21 Oct is Mehr, 23 Oct is Aban (Jalali).
    expect(report.driverMonths.map((r) => [r.period, r.vehicleIds])).toEqual([
      ['1405-07', ['v1']],
      ['1405-08', ['v2']],
    ]);
  });
});

describe('haul shift workbook', () => {
  const report = {
    routes: [{ id: 'r1', name: 'Route A' }],
    from: '2026-10-21T02:30:00Z',
    to: '2026-10-22T02:30:00Z',
    calendar: 'jalali' as const,
    truncated: false,
    shifts: shiftPlan([route('r1', 6, 12, 2, [])]),
    services: 3,
    workSec: 7200,
    distanceKm: 30,
    trucks: [
      { shiftNo: 1, services: 2, workSec: 3600, driverNames: ['Ali'] },
      { shiftNo: 2, services: 1, workSec: 1800, driverNames: ['Reza'] },
    ].map((row) => ({
      ...row,
      day: '2026-10-21',
      vehicleId: 'v1',
      vehicleName: 'T-12',
      serviceDistanceKm: 4,
      movingSec: 0,
      distanceKm: 10,
    })),
    drivers: [],
    driverDays: [],
    driverMonths: [
      {
        period: '1405-07',
        from: '2026-09-23',
        to: '2026-10-22',
        driverId: 'd1',
        driverName: 'Ali',
        services: 2,
        serviceDistanceKm: 4,
        workSec: 3600,
        movingSec: 0,
        distanceKm: 10,
        days: 1,
        shifts: 1,
        vehicleNames: ['T-12', 'T-7'],
        servicesByShift: { 1: 2 },
      },
    ],
  };

  it('pivots truck services into day and night columns, in Persian', () => {
    const sheets = haulShiftSheets(report, 'fa');
    expect(sheets.map((s) => s.name)).toEqual([
      'آمار سرویس رانندگان',
      'سرویس روزانه تراک',
      'ساعت کارکرد تراک',
      'کارکرد روزانه راننده',
      'کارکرد ماهانه راننده',
      'تراک‌های راننده در ماه',
    ]);
    const services = sheets[1];
    expect(services?.rtl).toBe(true);
    expect(services?.rows[0]).toEqual([
      'تاریخ',
      'تراک',
      'سرویس شیفت روز',
      'سرویس شیفت شب',
      'جمع سرویس',
      'رانندگان',
    ]);
    expect(services?.rows[1]).toEqual(['1405/07/29', 'T-12', 2, 1, 3, 'Ali، Reza']);
    expect(sheets[2]?.rows[1]).toEqual(['1405/07/29', 'T-12', 1, 0.5, 1.5, 20]);
    expect(sheets[5]?.rows[1]).toEqual(['مهر 1405', 'Ali', 2, 'T-12، T-7']);
  });

  it('names the columns after the routes when they are not one day / night pair', () => {
    const shifts = shiftPlan([route('Pit A', 6, 8, 1, []), route('Pit B', 14, 8, 1, [])]);
    const sheets = haulShiftSheets(
      {
        ...report,
        routes: [
          { id: 'Pit A', name: 'Pit A' },
          { id: 'Pit B', name: 'Pit B' },
        ],
        shifts,
      },
      'fa',
    );
    expect(sheets[1]?.rows[0]?.slice(2, 4)).toEqual(['سرویس Pit A', 'سرویس Pit B']);
  });

  it('can be built in English', () => {
    const sheets = haulShiftSheets(report, 'en');
    expect(sheets[1]?.rows[0]?.[2]).toBe('Services · day shift');
    expect(sheets[1]?.rtl).toBe(false);
  });
});

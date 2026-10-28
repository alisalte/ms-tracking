import { describe, expect, it } from '@jest/globals';
import { analyzeHaul, measureTruck, percentile } from '../domain/haul-analysis.js';
import { type TrackSample, type Zone, detectHaulCycles } from '../domain/haul-cycles.js';

const origin: Zone = {
  kind: 'polygon',
  ring: [
    [51, 35],
    [51.01, 35],
    [51.01, 35.01],
    [51, 35.01],
  ],
};
const destination: Zone = {
  kind: 'polygon',
  ring: [
    [51.05, 35.05],
    [51.06, 35.05],
    [51.06, 35.06],
    [51.05, 35.06],
  ],
};

const base = Date.UTC(2026, 5, 1, 6, 0, 0);
/** Minutes after 06:00 UTC. */
const m = (min: number) => new Date(base + min * 60_000);

const IN_ORIGIN = { lat: 35.005, lng: 51.005 };
const ON_ROAD = { lat: 35.03, lng: 51.03 };
const IN_DEST = { lat: 35.055, lng: 51.055 };

function fix(
  min: number,
  where: { lat: number; lng: number },
  speedKmh = 0,
  ignitionOn: boolean | null = true,
): TrackSample {
  return { at: m(min), ...where, speedKmh, ignitionOn };
}

const context = {
  drivers: [
    {
      vehicleId: 't1',
      driverId: 'd1',
      driverName: 'Ali',
      startedAt: m(-60),
      endedAt: null,
    },
  ],
  shiftStartHour: 6,
  shiftDurationHours: 12,
  shiftCount: 2,
  timeZone: 'UTC',
};

/** One truck, three services; the second is slow everywhere. */
function track(): TrackSample[] {
  return [
    // service 1: load 6 min, haul 4 min, unload 5 min, return 5 min
    fix(0, IN_ORIGIN),
    fix(5, IN_ORIGIN),
    fix(6, ON_ROAD, 30),
    fix(10, IN_DEST, 20),
    fix(11, IN_DEST),
    fix(14, IN_DEST),
    fix(15, ON_ROAD, 30),
    // service 2: load 21 min, haul 14 min (with a 13 min stop), unload 13 min, return 10 min
    fix(20, IN_ORIGIN),
    fix(40, IN_ORIGIN),
    fix(41, ON_ROAD, 30),
    fix(42, ON_ROAD, 0),
    fix(46, ON_ROAD, 0),
    fix(50, ON_ROAD, 0),
    fix(54, ON_ROAD, 0),
    fix(55, IN_DEST, 20),
    fix(56, IN_DEST),
    fix(67, IN_DEST),
    fix(68, ON_ROAD, 30),
    // service 3: load 5 min, haul 5 min, unload 4 min
    fix(78, IN_ORIGIN),
    fix(83, IN_ORIGIN),
    fix(84, ON_ROAD, 30),
    fix(88, IN_DEST, 20),
    fix(89, IN_DEST),
    fix(92, IN_DEST),
    fix(93, ON_ROAD, 30),
  ];
}

function run() {
  const samples = track();
  const { cycles, open } = detectHaulCycles({
    trucks: ['t1'],
    shovels: [],
    tracks: new Map([['t1', samples]]),
    origin,
    destination,
    ...context,
  });
  const measure = measureTruck({
    vehicleId: 't1',
    samples,
    cycles,
    origin,
    destination,
    ...context,
  });
  return { cycles, open, measure };
}

describe('haul analysis', () => {
  it('splits a service into load, haul, unload and return', () => {
    const { cycles, measure } = run();
    expect(cycles).toHaveLength(3);
    const first = measure.timings[0];
    expect(first).toMatchObject({ unloadSec: 5 * 60, returnSec: 5 * 60, cycleSec: 20 * 60 });
    expect(first?.cycle.loadDwellSec).toBe(6 * 60);
    // The last service has no later origin entry to measure a return to.
    expect(measure.timings[2]?.returnSec).toBeNull();
    expect(measure.timings[2]?.cycleSec).toBeNull();
    expect(measure.timings[2]?.unloadSec).toBe(5 * 60);
  });

  it('measures waste against the fleet reference and counts the lost services', () => {
    const { measure, open } = run();
    const analysis = analyzeHaul({ measures: [measure], open, now: m(100) });
    expect(analysis.services).toBe(3);
    // Three loads: 6, 21, 6 min → fewer than four samples, so the median (6) is the reference.
    expect(analysis.references.load.referenceSec).toBe(6 * 60);
    expect(analysis.references.load.source).toBe('FLEET');
    expect(analysis.waste.loadSec).toBe(15 * 60); // 21 − 6
    expect(analysis.waste.unloadSec).toBeGreaterThan(0);
    expect(analysis.waste.totalSec).toBe(
      analysis.waste.loadSec +
        analysis.waste.travelSec +
        analysis.waste.unloadSec +
        analysis.waste.returnSec,
    );
    expect(analysis.wasteShare).toBeGreaterThan(0);
    expect(analysis.wasteShare).toBeLessThan(1);
    expect(analysis.lostServices).toBeGreaterThan(0);
    expect(analysis.byVehicle[0]).toMatchObject({ vehicleId: 't1', services: 3 });
  });

  it('a configured target replaces the fleet reference', () => {
    const { measure, open } = run();
    const analysis = analyzeHaul({
      measures: [measure],
      open,
      now: m(100),
      targets: { loadSec: 10 * 60 },
    });
    expect(analysis.references.load).toMatchObject({ referenceSec: 600, source: 'CONFIGURED' });
    // Only the 21 min load is above 10 min.
    expect(analysis.waste.loadSec).toBe(11 * 60);
  });

  it('reports a long stop on the road with the driver and the loaded leg', () => {
    const { measure } = run();
    expect(measure.stops).toHaveLength(1);
    expect(measure.stops[0]).toMatchObject({
      vehicleId: 't1',
      durationSec: 13 * 60,
      engineOn: true,
      phase: 'LOADED',
      driverId: 'd1',
    });
    expect(measure.budget.idleOutsideSec).toBe(13 * 60);
  });

  it('time inside the zones and moving is accounted separately', () => {
    const { measure } = run();
    expect(measure.budget.originSec).toBeGreaterThan(0);
    expect(measure.budget.destinationSec).toBeGreaterThan(0);
    expect(measure.budget.movingSec).toBeGreaterThan(0);
    expect(measure.budget.noDataSec).toBeGreaterThan(0); // 68 → 78 min gap
    expect(measure.budget.parkedSec).toBe(0);
  });

  it('a lunch stop and a shift handover are told apart from the stops of the machine', () => {
    const breaks = {
      shiftStartMin: 6 * 60,
      shiftDurationMin: 12 * 60,
      shiftCount: 2,
      lunchStartMin: 6 * 60 + 20,
      lunchEndMin: 6 * 60 + 50,
      handoverWindowMin: 30,
      timeZone: 'UTC',
    };
    // Base time is 06:00 UTC. 0-4 min: handover (engine off at the boundary).
    // 25-45 min: lunch (engine on). 60-75 min: a real stop of the machine.
    const stand = (from: number, to: number, engineOn: boolean) => {
      const out: TrackSample[] = [];
      for (let min = from; min <= to; min += 4) out.push(fix(min, ON_ROAD, 0, engineOn));
      return out;
    };
    const samples = [
      ...stand(0, 12, false),
      fix(14, ON_ROAD, 30, true),
      fix(18, ON_ROAD, 30, true),
      fix(22, ON_ROAD, 30, true),
      ...stand(24, 44, true),
      fix(46, ON_ROAD, 30, true),
      fix(50, ON_ROAD, 30, true),
      fix(54, ON_ROAD, 30, true),
      fix(58, ON_ROAD, 30, true),
      ...stand(60, 76, true),
      fix(78, ON_ROAD, 30, true),
    ];
    const measure = measureTruck({
      vehicleId: 't1',
      samples,
      cycles: [],
      origin,
      destination,
      minStopSec: 300,
      breaks,
      ...context,
    });
    const byCategory = (c: string) => measure.stops.filter((s) => s.category === c);
    expect(byCategory('HANDOVER')).toHaveLength(1);
    expect(byCategory('LUNCH')).toHaveLength(1);
    expect(byCategory('OPERATIONAL')).toHaveLength(1);
    expect(byCategory('OPERATIONAL')[0]?.durationSec).toBe(18 * 60);
    // Lunch and handover seconds leave the machine's own standing buckets.
    expect(measure.budget.lunchSec).toBe(22 * 60);
    expect(measure.budget.handoverSec).toBe(14 * 60);
    expect(measure.budget.idleOutsideSec).toBe(18 * 60);
    expect(measure.budget.parkedSec).toBe(0);

    const analysis = analyzeHaul({ measures: [measure], open: [], now: m(100) });
    expect(analysis.stopCount).toBe(1);
    expect(analysis.stopSec).toBe(18 * 60);
    expect(analysis.plannedStops).toEqual({
      lunchCount: 1,
      lunchSec: 22 * 60,
      handoverCount: 1,
      handoverSec: 14 * 60,
    });
    expect(analysis.stops).toHaveLength(3);
  });

  it('a switched-off engine is parked time, not idle', () => {
    const samples = [
      fix(0, ON_ROAD, 0, true),
      fix(4, ON_ROAD, 0, false),
      fix(9, ON_ROAD, 0, false),
      fix(14, ON_ROAD, 30, true),
    ];
    const measure = measureTruck({
      vehicleId: 't1',
      samples,
      cycles: [],
      origin,
      destination,
      ...context,
    });
    expect(measure.budget.idleOutsideSec).toBe(4 * 60);
    expect(measure.budget.parkedSec).toBe(10 * 60);
    expect(measure.stops).toHaveLength(1);
    expect(measure.stops[0]?.engineOn).toBe(true);
  });

  it('flags a driver who is much slower than the fleet and counts services without a driver', () => {
    const fast = (id: string, start: number) => {
      const samples = [
        fix(start, IN_ORIGIN),
        fix(start + 5, IN_ORIGIN),
        fix(start + 6, ON_ROAD, 30),
        fix(start + 10, IN_DEST, 20),
        fix(start + 11, IN_DEST),
        fix(start + 14, IN_DEST),
        fix(start + 15, ON_ROAD, 30),
      ];
      return { id, samples };
    };
    const measures = [];
    for (const id of ['t1', 't2', 't3']) {
      const samples: TrackSample[] = [];
      for (let k = 0; k < 4; k += 1) samples.push(...fast(id, k * 30).samples);
      const ctx = {
        ...context,
        drivers: [
          { vehicleId: id, driverId: `d-${id}`, driverName: id, startedAt: m(-60), endedAt: null },
        ],
      };
      const { cycles } = detectHaulCycles({
        trucks: [id],
        shovels: [],
        tracks: new Map([[id, samples]]),
        origin,
        destination,
        ...ctx,
      });
      measures.push(measureTruck({ vehicleId: id, samples, cycles, origin, destination, ...ctx }));
    }
    // t4 loads for 15 minutes every time and has nobody assigned.
    const slow: TrackSample[] = [];
    for (let k = 0; k < 4; k += 1) {
      const s = k * 40;
      slow.push(
        fix(s, IN_ORIGIN),
        fix(s + 15, IN_ORIGIN),
        fix(s + 16, ON_ROAD, 30),
        fix(s + 20, IN_DEST, 20),
        fix(s + 21, IN_DEST),
        fix(s + 24, IN_DEST),
        fix(s + 25, ON_ROAD, 30),
      );
    }
    const slowCtx = { ...context, drivers: [] };
    const slowCycles = detectHaulCycles({
      trucks: ['t4'],
      shovels: [],
      tracks: new Map([['t4', slow]]),
      origin,
      destination,
      ...slowCtx,
    }).cycles;
    measures.push(
      measureTruck({
        vehicleId: 't4',
        samples: slow,
        cycles: slowCycles,
        origin,
        destination,
        ...slowCtx,
      }),
    );
    const analysis = analyzeHaul({ measures, open: [], now: m(300) });
    expect(analysis.withoutDriver).toBe(4);
    expect(analysis.findings.some((f) => f.code === 'NO_DRIVER')).toBe(true);
    // t4's slow loads push the median up only a little; the three regular drivers stay unflagged.
    expect(analysis.findings.filter((f) => f.code === 'DRIVER_SLOW_LOAD')).toEqual([]);
    expect(analysis.byDriver).toHaveLength(3);
  });

  it('marks an open loading overdue once it passes the p75 of loading', () => {
    const { measure } = run();
    const analysis = analyzeHaul({
      measures: [measure],
      open: [
        { vehicleId: 't1', phase: 'LOADING', since: m(0) },
        { vehicleId: 't2', phase: 'LOADING', since: m(98) },
      ],
      now: m(100),
    });
    expect(analysis.openHauls[0]?.overdue).toBe(true);
    expect(analysis.openHauls[1]?.overdue).toBe(false);
  });

  it('pairs queueing trucks and an idle shovel on the same excavator', () => {
    const t = (vehicleId: string, enter: number, left: number) => ({
      cycle: {
        vehicleId,
        shovelId: 's1',
        driverId: null,
        driverName: null,
        driverSource: null,
        originEnteredAt: m(enter),
        originLeftAt: m(left),
        destinationEnteredAt: m(left + 5),
        loadDwellSec: (left - enter) * 60,
        travelSec: 300,
        durationSec: (left - enter) * 60 + 300,
        distanceM: 1000,
        shift: '2026-06-01#1',
        shiftDate: '2026-06-01',
        shiftNo: 1,
      },
      destinationLeftAt: null,
      unloadSec: null,
      returnSec: null,
      cycleSec: null,
    });
    const measures = [
      {
        vehicleId: 'a',
        timings: [t('a', 0, 10), t('a', 40, 50)],
        budget: {
          originSec: 0,
          destinationSec: 0,
          movingSec: 0,
          idleOutsideSec: 0,
          parkedSec: 0,
          noDataSec: 0,
          lunchSec: 0,
          handoverSec: 0,
        },
        stops: [],
      },
      {
        vehicleId: 'b',
        // arrives at minute 6 while a is still loading → queues 4 minutes
        timings: [t('b', 6, 20), t('b', 55, 65)],
        budget: {
          originSec: 0,
          destinationSec: 0,
          movingSec: 0,
          idleOutsideSec: 0,
          parkedSec: 0,
          noDataSec: 0,
          lunchSec: 0,
          handoverSec: 0,
        },
        stops: [],
      },
    ];
    const analysis = analyzeHaul({ measures, open: [], now: m(100) });
    const shovel = analysis.byShovel[0];
    expect(shovel?.loads).toBe(4);
    // b queued 4 min behind a (10 − 6); gaps 20→40 (20 min) and 50→55 (5 min) leave the shovel idle.
    expect(shovel?.truckQueueSec).toBe(4 * 60);
    expect(shovel?.shovelIdleSec).toBe(25 * 60);
  });

  it('percentile interpolates and handles empty input', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([10], 0.75)).toBe(10);
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });
});

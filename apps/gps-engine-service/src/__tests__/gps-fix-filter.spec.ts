import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GpsFixFilter } from '../application/gps-fix-filter.js';
import { PositionPipeline } from '../application/position-pipeline.js';
import { type PositionSignal, SignalBus } from '../application/signal-bus.js';
import { TripEngine } from '../application/trip-engine.js';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import {
  type GpsFilterOptions,
  type GpsFixInput,
  type PrevFix,
  assessFix,
  hdopFromMetadata,
  speedCapFor,
} from '../domain/gps-fix-filter.js';
import { PositionEvent } from '../domain/position-event.js';

const OPTS: GpsFilterOptions = {
  minSatellites: 5,
  maxHdop: 5,
  maxSpeedKmh: 200,
  machineMaxSpeedKmh: { SHOVEL: 15 },
  mismatchMinSpeedKmh: 20,
  mismatchFactor: 3,
  mismatchSlackKmh: 10,
  maxGapS: 10,
  jumpMinDistanceM: 50,
};

const T0 = new Date('2026-10-23T07:40:20Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

function fix(p: Partial<GpsFixInput> = {}): GpsFixInput {
  return {
    latitude: 33.9295,
    longitude: 50.6705,
    speedKph: 0,
    satellites: 12,
    hdop: 1.2,
    capturedAt: at(0),
    ...p,
  };
}

/** Point `meters` north of the base fix. */
const north = (meters: number) => 33.9295 + meters / 111_195;

describe('assessFix — GPS plausibility rules', () => {
  it('passes a healthy moving truck fix through unchanged', () => {
    const prev: PrevFix = { latitude: 33.9295, longitude: 50.6705, capturedAt: at(0) };
    // 55 m in 5 s ≈ 40 km/h, reported 40.
    const v = assessFix(
      fix({ latitude: north(55), speedKph: 40, capturedAt: at(5) }),
      prev,
      'TRUCK',
      OPTS,
    );
    expect(v.quality).toBe('VALID');
    expect(v.speedKph).toBe(40);
    expect(v.reasons).toEqual([]);
  });

  it('flags few satellites / high HDOP as LOW_ACCURACY and zeroes speed', () => {
    expect(assessFix(fix({ satellites: 4, speedKph: 8 }), null, null, OPTS)).toMatchObject({
      quality: 'LOW_ACCURACY',
      speedKph: 0,
      reasons: ['LOW_SATELLITES'],
    });
    expect(assessFix(fix({ hdop: 16.5 }), null, null, OPTS).reasons).toEqual(['HIGH_HDOP']);
    // Unknown satellites/HDOP never trip the rule.
    expect(assessFix(fix({ satellites: null, hdop: null }), null, null, OPTS).quality).toBe(
      'VALID',
    );
  });

  it('caps speed by machine type (the 107 km/h excavator)', () => {
    const v = assessFix(fix({ speedKph: 107, satellites: 6 }), null, 'SHOVEL', OPTS);
    expect(v.quality).toBe('SUSPECT_JUMP');
    expect(v.speedKph).toBe(0);
    expect(v.reasons).toContain('OVER_MACHINE_CAP');
    expect(v.capKmh).toBe(15);
    // Same speed on a truck is fine.
    expect(assessFix(fix({ speedKph: 107 }), null, 'TRUCK', OPTS).quality).toBe('VALID');
    // Over the generic cap for any machine.
    expect(assessFix(fix({ speedKph: 566 }), null, null, OPTS).reasons).toContain(
      'OVER_MACHINE_CAP',
    );
  });

  it('flags a Doppler spike that the travelled distance does not support', () => {
    const prev: PrevFix = { latitude: 33.9295, longitude: 50.6705, capturedAt: at(0) };
    // Reported 59 km/h but moved 16 m in 4 s (14 km/h).
    const v = assessFix(
      fix({ latitude: north(16), speedKph: 59, capturedAt: at(4) }),
      prev,
      'TRUCK',
      OPTS,
    );
    expect(v.reasons).toEqual(['SPEED_DISTANCE_MISMATCH']);
    expect(v.quality).toBe('SUSPECT_JUMP');
    expect(v.distanceSpeedKmh).toBeCloseTo(14.4, 0);
  });

  it('does not treat a repeated coordinate as a stationary machine', () => {
    const prev: PrevFix = { latitude: 33.9295, longitude: 50.6705, capturedAt: at(0) };
    const v = assessFix(fix({ speedKph: 25, capturedAt: at(1) }), prev, 'TRUCK', OPTS);
    expect(v.quality).toBe('VALID');
    expect(v.distanceSpeedKmh).toBe(0);
  });

  it('flags a position jump above the cap, ignoring short noisy steps', () => {
    const prev: PrevFix = { latitude: 33.9295, longitude: 50.6705, capturedAt: at(0) };
    // 157 m in 2 s on a shovel.
    expect(
      assessFix(fix({ latitude: north(157), capturedAt: at(2) }), prev, 'SHOVEL', OPTS).reasons,
    ).toEqual(['POSITION_JUMP']);
    // 20 m in 1 s (72 km/h) is below the jump distance floor.
    expect(
      assessFix(fix({ latitude: north(20), capturedAt: at(1) }), prev, 'SHOVEL', OPTS).quality,
    ).toBe('VALID');
  });

  it('skips distance checks against an old or newer previous fix', () => {
    const old: PrevFix = { latitude: 33.9295, longitude: 50.6705, capturedAt: at(-120) };
    const newer: PrevFix = { latitude: 33.9295, longitude: 50.6705, capturedAt: at(10) };
    const f = fix({ latitude: north(16), speedKph: 59 });
    expect(assessFix(f, old, 'TRUCK', OPTS).quality).toBe('VALID');
    expect(assessFix(f, newer, 'TRUCK', OPTS).quality).toBe('VALID');
  });

  it('never lets a machine cap exceed the generic cap', () => {
    expect(speedCapFor('X', { ...OPTS, machineMaxSpeedKmh: { X: 500 } })).toBe(200);
    expect(speedCapFor(null, OPTS)).toBe(200);
  });

  it('reads HDOP from a Meitrack CCE record', () => {
    expect(hdopFromMetadata({ cce: { status: { hdop: 2.8 } } })).toBe(2.8);
    expect(hdopFromMetadata({ cce: {} })).toBeNull();
    expect(hdopFromMetadata(undefined)).toBeNull();
  });
});

// --- Pipeline + trip-engine integration ---

const NOW = new Date('2026-10-23T07:40:30Z');
const TENANT = '11111111-1111-1111-1111-111111111111';
const VEHICLE = '22222222-2222-2222-2222-222222222222';

function event(p: { id: string; speed: number; sats?: number; at?: Date }): PositionEvent {
  return new PositionEvent({
    messageId: p.id,
    vehicleId: VEHICLE,
    tenantId: TENANT,
    latitude: 33.9295,
    longitude: 50.6705,
    speedKph: p.speed,
    headingDeg: 0,
    altitudeM: null,
    satellites: p.sats ?? 12,
    ignitionOn: true,
    capturedAt: p.at ?? new Date(NOW.getTime() - 2_000),
    ingestedAt: NOW,
    protocolId: 'meitrack',
    quality: 'VALID',
    metadata: { cce: { can: { present: false }, paramIds: [], status: { hdop: 1.5 } } },
  });
}

function buildPipeline(machineType: string | null) {
  const inserted: PositionEvent[] = [];
  const cached: PositionEvent[] = [];
  const tripped: PositionEvent[] = [];
  const signalBus = new SignalBus();
  const signals: PositionSignal[] = [];
  signalBus.onPosition((s) => signals.push(s));
  const pipeline = new PositionPipeline({
    config: {
      GPS_STALE_AFTER_SECONDS: 300,
      GPS_FUTURE_THRESHOLD_SECONDS: 60,
    } as unknown as GpsEngineConfig,
    positions: { insert: async (e: PositionEvent) => void inserted.push(e) } as never,
    cache: { setLatest: async (e: PositionEvent) => void cached.push(e) } as never,
    signalBus,
    tripEngine: {
      process: async (e: PositionEvent) => {
        tripped.push(e);
        return { skipped: null };
      },
    } as never,
    gpsFilter: new GpsFixFilter({
      options: OPTS,
      prevFix: async () => null,
      machineType: async () => machineType,
    }),
  });
  return { pipeline, inserted, cached, tripped, signals };
}

describe('PositionPipeline with the GPS filter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists a capped shovel fix with speed 0 and the raw speed in metadata, not live', async () => {
    const { pipeline, inserted, cached, tripped, signals } = buildPipeline('SHOVEL');
    await pipeline.process(event({ id: 'm1', speed: 107 }));

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.speedKph).toBe(0);
    expect(inserted[0]?.quality).toBe('SUSPECT_JUMP');
    expect(inserted[0]?.metadata?.gpsFilter).toMatchObject({
      rawSpeedKph: 107,
      reasons: ['OVER_MACHINE_CAP'],
      capKmh: 15,
      machineType: 'SHOVEL',
    });
    expect(inserted[0]?.metadata?.cce).toBeDefined();
    expect(tripped[0]?.speedKph).toBe(0);
    expect(cached).toHaveLength(0);
    expect(signals).toHaveLength(0);
  });

  it('keeps a LOW_ACCURACY fix live but with speed 0', async () => {
    const { pipeline, inserted, cached, signals } = buildPipeline('TRUCK');
    await pipeline.process(event({ id: 'm2', speed: 12, sats: 3 }));

    expect(inserted[0]?.quality).toBe('LOW_ACCURACY');
    expect(cached[0]?.speedKph).toBe(0);
    expect(signals[0]?.speedKph).toBe(0);
  });

  it('keeps STALE quality on an old flagged fix', async () => {
    const { pipeline, inserted } = buildPipeline('SHOVEL');
    await pipeline.process(event({ id: 'm3', speed: 107, at: new Date(NOW.getTime() - 600_000) }));
    expect(inserted[0]?.quality).toBe('STALE');
    expect(inserted[0]?.speedKph).toBe(0);
  });

  it('leaves a clean fix untouched', async () => {
    const { pipeline, inserted } = buildPipeline('TRUCK');
    await pipeline.process(event({ id: 'm4', speed: 42 }));
    expect(inserted[0]?.quality).toBe('VALID');
    expect(inserted[0]?.speedKph).toBe(42);
    expect(inserted[0]?.metadata?.gpsFilter).toBeUndefined();
  });
});

describe('TripEngine mileage on flagged fixes', () => {
  function engine() {
    const nums = new Map<string, number>();
    const json = new Map<string, string>();
    let prev: PositionEvent | null = null;
    const e = new TripEngine({
      config: {
        GPS_TRIP_START_SPEED_KMH: 10,
        GPS_TRIP_START_DURATION_S: 30,
        GPS_TRIP_MIN_DISTANCE_M: 250,
        GPS_TRIP_STOP_SPEED_KMH: 3,
        GPS_TRIP_MIN_STOP_DURATION_S: 300,
        GPS_TRIP_MAX_GAP_S: 600,
        GPS_IDLE_SPEED_KMH: 1,
        GPS_IDLE_THRESHOLD_S: 180,
        GPS_IDLE_ALERT_THRESHOLD_S: 900,
        GPS_PARKING_THRESHOLD_S: 1800,
        GPS_MILEAGE_DEDUPE_DISTANCE_M: 1,
        GPS_MILEAGE_MAX_SPEED_KMH: 300,
      } as unknown as GpsEngineConfig,
      fsmCache: {
        get: async (_t: string, _v: string, f: string) => {
          const r = json.get(f);
          return r ? JSON.parse(r) : null;
        },
        set: async (_t: string, _v: string, f: string, v: unknown) =>
          void json.set(f, JSON.stringify(v)),
        getNumber: async (_t: string, _v: string, f: string) => nums.get(f) ?? 0,
        setNumber: async (_t: string, _v: string, f: string, v: number) => void nums.set(f, v),
      } as never,
      positionCache: {
        getPrevPos: async () => prev,
        setPrevPos: async (p: PositionEvent) => {
          prev = p;
        },
      } as never,
      tripRepo: {
        insertTripStart: async () => {},
        completeTrip: async () => ({ updated: 1 }),
        discardTrip: async () => ({ updated: 1 }),
        insertEngineHours: async () => {},
        insertIdlePeriod: async () => {},
        insertParkingPeriod: async () => {},
      } as never,
      signalBus: new SignalBus(),
    });
    return { e, odo: () => nums.get('odo') ?? 0 };
  }

  const p = (id: string, s: number, meters: number, quality: PositionEvent['quality']) =>
    new PositionEvent({
      ...event({ id, speed: 30, at: at(s) }),
      latitude: north(meters),
      quality,
    });

  it('adds distance for valid fixes but none for a flagged one', async () => {
    const { e, odo } = engine();
    await e.process(p('a', 0, 0, 'VALID'));
    await e.process(p('b', 5, 40, 'VALID'));
    expect(odo()).toBeCloseTo(40, 0);
    await e.process(p('c', 7, 200, 'SUSPECT_JUMP'));
    expect(odo()).toBeCloseTo(40, 0);
  });
});

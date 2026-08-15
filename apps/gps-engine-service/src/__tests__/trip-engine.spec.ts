import { describe, expect, it } from '@jest/globals';
import { SignalBus } from '../application/signal-bus.js';
import { TripEngine } from '../application/trip-engine.js';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import { PositionEvent } from '../domain/position-event.js';
import type { EngineHoursFlushedEvent, TripDiscardedEvent } from '../domain/trip/trip-types.js';
import type { LatestPosition } from '../infrastructure/persistence/position.repository.js';

/**
 * Unit tests for TripEngine's persistence wiring (Sprint A). Uses hand-rolled
 * fakes for the Redis caches + repository (no DB), mirroring the repo's existing
 * fake-based test style. The FSMs themselves are unit-tested in their own specs;
 * these tests assert the engine *connects* their outputs to the right repo calls:
 *  - micro-trip → discardTrip (not completeTrip), no orphan ACTIVE.
 *  - engine-hours flush → insertEngineHours (durable).
 *  - trip.discarded is persisted but NOT signaled to WS clients.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const VEHICLE = '22222222-2222-2222-2222-222222222222';

/** Config slice with the thresholds the engine reads (values mirror trip-fsm.spec). */
function fakeConfig(): GpsEngineConfig {
  return {
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
  } as unknown as GpsEngineConfig;
}

class FakeFsmCache {
  private json = new Map<string, string>();
  private nums = new Map<string, number>();
  private k(t: string, v: string, f: string) {
    return `${t}:${v}:${f}`;
  }
  async get<T>(t: string, v: string, f: string): Promise<T | null> {
    const r = this.json.get(this.k(t, v, f));
    return r ? (JSON.parse(r) as T) : null;
  }
  async set<T>(t: string, v: string, f: string, val: T): Promise<void> {
    this.json.set(this.k(t, v, f), JSON.stringify(val));
  }
  async getNumber(t: string, v: string, f: string): Promise<number> {
    return this.nums.get(this.k(t, v, f)) ?? 0;
  }
  async setNumber(t: string, v: string, f: string, val: number): Promise<void> {
    this.nums.set(this.k(t, v, f), val);
  }
}

class FakePositionCache {
  private prev: LatestPosition | null = null;
  async getPrevPos(): Promise<LatestPosition | null> {
    return this.prev;
  }
  async setPrevPos(e: PositionEvent): Promise<void> {
    this.prev = {
      vehicleId: e.vehicleId,
      tenantId: e.tenantId,
      latitude: e.latitude,
      longitude: e.longitude,
      speedKph: e.speedKph,
      headingDeg: e.headingDeg,
      altitudeM: e.altitudeM,
      ignitionOn: e.ignitionOn,
      capturedAt: e.capturedAt,
      ingestedAt: e.ingestedAt,
      quality: 1,
    };
  }
}

class FakeTripRepo {
  public readonly calls: string[] = [];
  public readonly discarded: TripDiscardedEvent[] = [];
  public readonly engineHours: EngineHoursFlushedEvent[] = [];
  async insertTripStart(): Promise<void> {
    this.calls.push('insertTripStart');
  }
  async completeTrip(): Promise<{ updated: number }> {
    this.calls.push('completeTrip');
    return { updated: 1 };
  }
  async discardTrip(e: TripDiscardedEvent): Promise<{ updated: number }> {
    this.calls.push('discardTrip');
    this.discarded.push(e);
    return { updated: 1 };
  }
  async insertEngineHours(e: EngineHoursFlushedEvent): Promise<void> {
    this.calls.push('insertEngineHours');
    this.engineHours.push(e);
  }
  async insertIdlePeriod(): Promise<void> {
    this.calls.push('insertIdlePeriod');
  }
  async insertParkingPeriod(): Promise<void> {
    this.calls.push('insertParkingPeriod');
  }
}

function buildEngine() {
  const fsmCache = new FakeFsmCache();
  const positionCache = new FakePositionCache();
  const tripRepo = new FakeTripRepo();
  const signalBus = new SignalBus();
  const engine = new TripEngine({
    config: fakeConfig(),
    fsmCache: fsmCache as never,
    positionCache: positionCache as never,
    tripRepo: tripRepo as never,
    signalBus,
  });
  return { engine, tripRepo, signalBus };
}

function pos(speed: number, ignition: boolean | null, at: Date, messageId: string): PositionEvent {
  return new PositionEvent({
    messageId,
    vehicleId: VEHICLE,
    tenantId: TENANT,
    latitude: 22.9,
    longitude: 113.4,
    speedKph: speed,
    headingDeg: 0,
    altitudeM: null,
    satellites: null,
    ignitionOn: ignition,
    capturedAt: at,
    ingestedAt: at,
    protocolId: 'gt06',
    quality: 'VALID',
  });
}

describe('TripEngine persistence wiring (Sprint A)', () => {
  it('discards a micro-trip via discardTrip (no completeTrip, no orphan ACTIVE)', async () => {
    const { engine, tripRepo } = buildEngine();
    const T0 = new Date('2026-08-06T10:00:00Z');
    const T400 = new Date('2026-08-06T10:06:40Z'); // 400s > minStopDuration 300

    // 1) moving → trip.started (insertTripStart). 2) stop, same point, 0 distance
    //    → micro-trip → trip.discarded (discardTrip). No real trip.ended.
    await engine.process(pos(50, true, T0, 'm1'));
    await engine.process(pos(0, true, T400, 'm2'));

    expect(tripRepo.calls).toContain('insertTripStart');
    expect(tripRepo.calls).toContain('discardTrip');
    expect(tripRepo.calls).not.toContain('completeTrip');
    expect(tripRepo.discarded).toHaveLength(1);
    expect(tripRepo.discarded[0]?.reason).toBe('MICRO_TRIP');
    expect(tripRepo.discarded[0]?.startedAt.toISOString()).toBe(T0.toISOString());
  });

  it('persists an engine-hours flush durably via insertEngineHours', async () => {
    const { engine, tripRepo } = buildEngine();
    const T0 = new Date('2026-08-06T10:00:00Z');
    const T400 = new Date('2026-08-06T10:06:40Z'); // 400s of ign-on accrual
    const T401 = new Date('2026-08-06T10:06:41Z'); // ignition-off edge → flush

    await engine.process(pos(50, true, T0, 'm1'));
    await engine.process(pos(0, true, T400, 'm2'));
    await engine.process(pos(0, false, T401, 'm3')); // flush

    expect(tripRepo.calls).toContain('insertEngineHours');
    expect(tripRepo.engineHours).toHaveLength(1);
    const eh = tripRepo.engineHours[0];
    expect(eh).toBeDefined();
    // 400s (T0→T400) + 1s (T400→T401) = 401s of engine-on time.
    expect(eh?.durationSec).toBe(401);
    expect(eh?.engineHours).toBeCloseTo(401 / 3600, 6);
    expect(eh?.windowEnd.toISOString()).toBe(T401.toISOString());
    // window_start is exact (telescoping Δt): windowEnd − durationSec.
    expect(eh?.windowStart.toISOString()).toBe(new Date(T401.getTime() - 401_000).toISOString());
    expect(eh?.sourceEventId).toBe('m3'); // idempotency key = flush-trigger messageId
    expect(eh?.vehicleId).toBe(VEHICLE);
    expect(eh?.tenantId).toBe(TENANT);
  });

  it('does NOT signal trip.discarded to WS clients (internal bookkeeping)', async () => {
    const { engine, signalBus } = buildEngine();
    const signaled: string[] = [];
    signalBus.onTrip((e) => signaled.push(e.type));

    const T0 = new Date('2026-08-06T10:00:00Z');
    const T400 = new Date('2026-08-06T10:06:40Z');
    await engine.process(pos(50, true, T0, 'm1'));
    await engine.process(pos(0, true, T400, 'm2')); // micro-trip discard

    expect(signaled).toContain('trip.started');
    expect(signaled).not.toContain('trip.discarded');
    expect(signaled).not.toContain('trip.ended');
    signalBus.close();
  });
});

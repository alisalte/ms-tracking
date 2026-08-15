import { beforeEach, describe, expect, it } from '@jest/globals';
import { DeviceStatusPipeline } from '../application/device-status-pipeline.js';
import { TripEngine } from '../application/trip-engine.js';
import { PositionEvent } from '../domain/position-event.js';
import { DeviceStatusRecord } from '../domain/device-status.js';
import type { RedisFsmCache } from '../infrastructure/cache/redis-fsm-cache.js';
import type { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';
import type { SignalBus } from '../application/signal-bus.js';
import type { TripRepository } from '../infrastructure/persistence/trip.repository.js';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import type { RedisDeviceStatusCache } from '../infrastructure/cache/redis-device-status-cache.js';
import type { DeviceStatusRepository } from '../infrastructure/persistence/device-status.repository.js';

/**
 * Sprint D §21 — out-of-order telemetry policy, and §7/§8 — the
 * DUPLICATE_SESSION lifecycle no-op. Real devices send delayed packets:
 * T2 then T1. The chosen policy: PERSIST both (the hypertable is a
 * time-series), but the older packet must NOT regress the FSM/prev-pos
 * baseline nor hit the live broadcast.
 */

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEHICLE = '22222222-2222-2222-2222-222222222222';

/** In-memory prevpos store standing in for RedisPositionCache. */
class FakePositionCache {
  public prev: { capturedAt: Date; lat: number; lng: number } | null = null;
  public latest: { capturedAt: Date } | null = null;
  async getPrevPos() {
    return this.prev
      ? {
          latitude: this.prev.lat,
          longitude: this.prev.lng,
          speedKph: 0,
          headingDeg: 0,
          altitudeM: null,
          ignitionOn: null,
          capturedAt: this.prev.capturedAt,
          ingestedAt: this.prev.capturedAt,
        }
      : null;
  }
  async setPrevPos(p: PositionEvent) {
    this.prev = { capturedAt: p.capturedAt, lat: p.latitude, lng: p.longitude };
  }
  async setLatest(p: PositionEvent) {
    this.latest = { capturedAt: p.capturedAt };
  }
}

class FakeFsmCache {
  public store = new Map<string, unknown>();
  async get(tenantId: string, vehicleId: string, kind: string) {
    return this.store.get(`${tenantId}:${vehicleId}:${kind}`) ?? null;
  }
  async set(tenantId: string, vehicleId: string, kind: string, value: unknown) {
    this.store.set(`${tenantId}:${vehicleId}:${kind}`, value);
  }
  async getNumber() {
    return 0;
  }
  async setNumber() {}
}

/** No-op trip repository (persist calls recorded, never throw). */
class FakeTripRepo {
  public starts = 0;
  public completions = 0;
  public discards = 0;
  public idlePeriods = 0;
  public parkingPeriods = 0;
  public engineHours = 0;
  async insertTripStart() {
    this.starts++;
  }
  async completeTrip() {
    this.completions++;
    return { updated: 1 };
  }
  async discardTrip() {
    this.discards++;
    return { updated: 1 };
  }
  async insertIdlePeriod() {
    this.idlePeriods++;
  }
  async insertParkingPeriod() {
    this.parkingPeriods++;
  }
  async insertEngineHours() {
    this.engineHours++;
  }
}

function positionAt(ts: Date, lat: number): PositionEvent {
  return new PositionEvent({
    messageId: `evt-${ts.getTime()}-${lat}`,
    vehicleId: VEHICLE,
    tenantId: TENANT,
    latitude: lat,
    longitude: 51.4,
    speedKph: 30,
    headingDeg: 90,
    altitudeM: null,
    satellites: 8,
    ignitionOn: true,
    capturedAt: ts,
    ingestedAt: ts,
    protocolId: 'gt06',
    quality: 'VALID',
  });
}

describe('Sprint D §21 — out-of-order policy (persist-only, no baseline regression)', () => {
  let cache: FakePositionCache;
  let engine: TripEngine;

  beforeEach(() => {
    cache = new FakePositionCache();
    const config = {
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
    engine = new TripEngine({
      config,
      fsmCache: new FakeFsmCache() as unknown as RedisFsmCache,
      positionCache: cache as unknown as RedisPositionCache,
      tripRepo: new FakeTripRepo() as unknown as TripRepository,
      signalBus: {} as SignalBus,
    });
  });

  it('an older packet (T1 after T2) is skipped: prev-pos baseline does NOT regress', async () => {
    const t2 = new Date('2026-08-14T10:02:00Z');
    const t1 = new Date('2026-08-14T10:00:00Z'); // delayed packet

    const outcomeT2 = await engine.process(positionAt(t2, 35.7));
    expect(outcomeT2.skipped).toBeNull();
    expect(cache.prev?.capturedAt).toEqual(t2);

    const outcomeT1 = await engine.process(positionAt(t1, 35.6));
    expect(outcomeT1.skipped).toBe('OUT_OF_ORDER');
    // prev-pos still names T2 — the older packet did not regress it.
    expect(cache.prev?.capturedAt).toEqual(t2);
  });

  it('equal timestamps are processed (only strictly older is out-of-order)', async () => {
    const t = new Date('2026-08-14T10:00:00Z');
    const first = await engine.process(positionAt(t, 35.7));
    expect(first.skipped).toBeNull();
    // Same timestamp, deduped by messageId difference — still in-order.
    const second = await engine.process(positionAt(t, 35.71));
    expect(second.skipped).toBeNull();
  });

  it('an in-order packet after an out-of-order one still processes normally', async () => {
    const t2 = new Date('2026-08-14T10:02:00Z');
    const t1 = new Date('2026-08-14T10:01:00Z');
    const t3 = new Date('2026-08-14T10:03:00Z');
    await engine.process(positionAt(t2, 35.7));
    await engine.process(positionAt(t1, 35.6));
    const outcome = await engine.process(positionAt(t3, 35.8));
    expect(outcome.skipped).toBeNull();
    expect(cache.prev?.capturedAt).toEqual(t3);
  });
});

describe('Sprint D §7/§8 — DUPLICATE_SESSION disconnect keeps the device ONLINE', () => {
  class FakeStatusRepo {
    public upserts: DeviceStatusRecord[] = [];
    async upsert(record: DeviceStatusRecord) {
      this.upserts.push(record);
    }
  }
  class FakeStatusCache {
    public cache: DeviceStatusRecord[] = [];
    async setStatus(record: DeviceStatusRecord) {
      this.cache.push(record);
    }
  }
  const bus = {
    emitted: [] as DeviceStatusRecord[],
    emitDeviceStatus(record: DeviceStatusRecord) {
      this.emitted.push(record);
    },
  };

  function pipeline(repo: FakeStatusRepo): DeviceStatusPipeline {
    return new DeviceStatusPipeline({
      statusRepo: repo as unknown as DeviceStatusRepository,
      statusCache: new FakeStatusCache() as unknown as RedisDeviceStatusCache,
      signalBus: bus as unknown as SignalBus,
    });
  }

  it('a DISCONNECTED with reason DUPLICATE_SESSION is ignored (new session owns state)', async () => {
    const repo = new FakeStatusRepo();
    await pipeline(repo).process(
      new DeviceStatusRecord({
        deviceId: 'd',
        tenantId: TENANT,
        state: 'OFFLINE',
        protocolId: 'gt06',
        reason: 'DUPLICATE_SESSION',
        lastSeenAt: new Date(),
      }),
    );
    expect(repo.upserts).toHaveLength(0); // no write, no cache, no broadcast
    expect(bus.emitted).toHaveLength(0);
  });

  it('a REAL disconnect still upserts + broadcasts OFFLINE', async () => {
    const repo = new FakeStatusRepo();
    await pipeline(repo).process(
      new DeviceStatusRecord({
        deviceId: 'd',
        tenantId: TENANT,
        state: 'OFFLINE',
        protocolId: 'gt06',
        reason: 'REMOTE_DISCONNECT',
        lastSeenAt: new Date(),
      }),
    );
    expect(repo.upserts).toHaveLength(1);
    expect(bus.emitted).toHaveLength(1);
    bus.emitted.length = 0;
  });
});

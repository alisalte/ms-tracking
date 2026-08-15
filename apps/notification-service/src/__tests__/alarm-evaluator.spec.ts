import { describe, expect, it } from '@jest/globals';
import {
  DeviceOfflineEvaluator,
  ExcessiveTripDurationEvaluator,
  OverspeedEvaluator,
  ParkingEvaluator,
  ProlongedIdleEvaluator,
  TripStartedEvaluator,
} from '../application/evaluators/evaluators.js';
import type { InputSignal } from '../application/evaluators/rule-evaluator.js';
import { AlarmRule } from '../domain/alarm-rule.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEHICLE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEVICE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function makeRule(
  type: string,
  conditions: Record<string, unknown> = {},
  entityId: string | null = null,
) {
  return AlarmRule.create('rule-1', {
    tenantId: TENANT,
    name: 'test rule',
    type: type as never,
    severity: 'HIGH',
    enabled: true,
    entityType: 'vehicle',
    entityId,
    conditions,
    cooldownSec: 300,
    dedupWindowSec: 600,
    repeatPolicy: 'COOLDOWN',
  });
}

function positionSignal(overrides: Partial<Extract<InputSignal, { kind: 'position' }>> = {}) {
  return {
    kind: 'position',
    tenantId: TENANT,
    vehicleId: VEHICLE,
    deviceId: DEVICE,
    lat: 35,
    lng: 51,
    speedKph: 95,
    headingDeg: 0,
    capturedAt: '2026-01-01T00:00:00Z',
    ignitionOn: true,
    sourceEventId: 'msg-1',
    ...overrides,
  } as const satisfies Extract<InputSignal, { kind: 'position' }>;
}

describe('OverspeedEvaluator', () => {
  const eval_ = new OverspeedEvaluator();
  const rule = makeRule('overspeed', { thresholdKmh: 80 });

  it('fires when speed exceeds the threshold', () => {
    const event = eval_.evaluate(positionSignal({ speedKph: 95 }), rule);
    expect(event).not.toBeNull();
    expect(event?.type).toBe('overspeed');
    expect(event?.severity).toBe('HIGH');
  });

  it('does NOT fire when speed is at or below the threshold', () => {
    expect(eval_.evaluate(positionSignal({ speedKph: 80 }), rule)).toBeNull();
  });

  it('does NOT fire on an implausible GPS speed spike (>300 km/h)', () => {
    expect(eval_.evaluate(positionSignal({ speedKph: 999 }), rule)).toBeNull();
  });

  it('ignores non-position signals', () => {
    const signal: InputSignal = {
      kind: 'device_status',
      tenantId: TENANT,
      vehicleId: DEVICE,
      deviceId: DEVICE,
      state: 'OFFLINE',
      lastSeenAt: '2026-01-01T00:00:00Z',
      sourceEventId: null,
    };
    expect(eval_.evaluate(signal, rule)).toBeNull();
  });
});

describe('DeviceOfflineEvaluator', () => {
  const eval_ = new DeviceOfflineEvaluator();
  const rule = makeRule('device_offline');

  it('fires on OFFLINE state', () => {
    const signal: InputSignal = {
      kind: 'device_status',
      tenantId: TENANT,
      vehicleId: DEVICE,
      deviceId: DEVICE,
      state: 'OFFLINE',
      lastSeenAt: '2026-01-01T00:00:00Z',
      sourceEventId: null,
    };
    const event = eval_.evaluate(signal, rule);
    expect(event).not.toBeNull();
    expect(event?.type).toBe('device_offline');
  });

  it('fires on STALE state', () => {
    const signal: InputSignal = {
      kind: 'device_status',
      tenantId: TENANT,
      vehicleId: DEVICE,
      deviceId: DEVICE,
      state: 'STALE',
      lastSeenAt: '2026-01-01T00:00:00Z',
      sourceEventId: null,
    };
    expect(eval_.evaluate(signal, rule)).not.toBeNull();
  });

  it('does NOT fire on ONLINE state', () => {
    const signal: InputSignal = {
      kind: 'device_status',
      tenantId: TENANT,
      vehicleId: DEVICE,
      deviceId: DEVICE,
      state: 'ONLINE',
      lastSeenAt: '2026-01-01T00:00:00Z',
      sourceEventId: null,
    };
    expect(eval_.evaluate(signal, rule)).toBeNull();
  });
});

describe('TripStartedEvaluator', () => {
  const eval_ = new TripStartedEvaluator();
  const rule = makeRule('trip_started');

  it('fires on trip.started', () => {
    const signal: InputSignal = {
      kind: 'trip',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'trip.started',
      durationSec: 0,
      distanceKm: 0,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:00:00Z',
      sourceEventId: 'msg-2:trip.started',
    };
    const event = eval_.evaluate(signal, rule);
    expect(event?.type).toBe('trip_started');
  });

  it('does NOT fire on trip.ended', () => {
    const signal: InputSignal = {
      kind: 'trip',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'trip.ended',
      durationSec: 100,
      distanceKm: 5,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:00:00Z',
      sourceEventId: 'msg-3:trip.ended',
    };
    expect(eval_.evaluate(signal, rule)).toBeNull();
  });
});

describe('ExcessiveTripDurationEvaluator', () => {
  const eval_ = new ExcessiveTripDurationEvaluator();

  it('fires when duration exceeds maxDurationSec', () => {
    const rule = makeRule('excessive_trip_duration', { maxDurationSec: 3600 });
    const signal: InputSignal = {
      kind: 'trip',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'trip.ended',
      durationSec: 5000,
      distanceKm: 200,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T02:00:00Z',
      sourceEventId: 'msg-4:trip.ended',
    };
    const event = eval_.evaluate(signal, rule);
    expect(event?.type).toBe('excessive_trip_duration');
  });

  it('does NOT fire when duration is within limit', () => {
    const rule = makeRule('excessive_trip_duration', { maxDurationSec: 3600 });
    const signal: InputSignal = {
      kind: 'trip',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'trip.ended',
      durationSec: 1800,
      distanceKm: 50,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:30:00Z',
      sourceEventId: 'msg-5:trip.ended',
    };
    expect(eval_.evaluate(signal, rule)).toBeNull();
  });
});

describe('ProlongedIdleEvaluator (Sprint G — gps-engine idle FSM)', () => {
  const eval_ = new ProlongedIdleEvaluator();
  const rule = makeRule('prolonged_idle', { minDurationSec: 900 });

  it('fires on idle.ended meeting the threshold', () => {
    const signal: InputSignal = {
      kind: 'idle',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'idle.ended',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:25:00Z',
      durationSec: 1500,
      sourceEventId: 'msg-6:idle.ended',
    };
    const event = eval_.evaluate(signal, rule);
    expect(event?.type).toBe('prolonged_idle');
  });

  it('does NOT fire below the threshold', () => {
    const signal: InputSignal = {
      kind: 'idle',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'idle.ended',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:05:00Z',
      durationSec: 300,
      sourceEventId: 'msg-7:idle.ended',
    };
    expect(eval_.evaluate(signal, rule)).toBeNull();
  });
});

describe('ParkingEvaluator (Sprint G — gps-engine parking FSM)', () => {
  const eval_ = new ParkingEvaluator();
  const rule = makeRule('parking', { minDurationSec: 3600 });

  it('fires on parking.ended meeting the threshold', () => {
    const signal: InputSignal = {
      kind: 'parking',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'parking.ended',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T03:00:00Z',
      durationSec: 10_800,
      sourceEventId: 'msg-8:parking.ended',
    };
    const event = eval_.evaluate(signal, rule);
    expect(event?.type).toBe('parking');
  });

  it('does NOT fire below the threshold', () => {
    const signal: InputSignal = {
      kind: 'parking',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'parking.ended',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:30:00Z',
      durationSec: 1800,
      sourceEventId: 'msg-9:parking.ended',
    };
    expect(eval_.evaluate(signal, rule)).toBeNull();
  });
});

describe('AlarmStateCache dedup (shouldSuppress)', () => {
  // The dedup logic uses Redis SET NX — test the contract via a fake.
  it('suppresses on the second call within the window (SET NX contract)', async () => {
    const stored = new Map<string, string>();
    const fakeRedis = {
      set: async (key: string, val: string, ...opts: unknown[]) => {
        const hasNx = opts.includes('NX');
        if (hasNx && stored.has(key)) return null;
        stored.set(key, val);
        return 'OK';
      },
    };
    const { AlarmStateCache } = await import('../infrastructure/cache/alarm-state-cache.js');
    const cache = new AlarmStateCache(fakeRedis as never);
    const first = await cache.shouldSuppress(TENANT, 'rule-1', VEHICLE, 600);
    expect(first).toBe(false);
    const second = await cache.shouldSuppress(TENANT, 'rule-1', VEHICLE, 600);
    expect(second).toBe(true);
  });

  it('marks events duplicate by eventId (idempotency contract)', async () => {
    const stored = new Set<string>();
    const fakeRedis = {
      set: async (key: string, _val: string, ...opts: unknown[]) => {
        if (opts.includes('NX') && stored.has(key)) return null;
        stored.add(key);
        return 'OK';
      },
    };
    const { AlarmStateCache } = await import('../infrastructure/cache/alarm-state-cache.js');
    const cache = new AlarmStateCache(fakeRedis as never);
    expect(await cache.isDuplicateEvent(TENANT, 'evt-1')).toBe(false);
    expect(await cache.isDuplicateEvent(TENANT, 'evt-1')).toBe(true);
    expect(await cache.isDuplicateEvent(TENANT, 'evt-2')).toBe(false);
  });
});

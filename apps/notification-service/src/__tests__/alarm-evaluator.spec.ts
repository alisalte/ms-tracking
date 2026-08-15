import { describe, expect, it } from '@jest/globals';
import {
  DeviceOfflineEvaluator,
  ExcessiveTripDurationEvaluator,
  OverspeedEvaluator,
  TripStartedEvaluator,
} from '../application/evaluators/evaluators.js';
import type { InputSignal } from '../application/evaluators/rule-evaluator.js';
import { AlarmRule } from '../domain/alarm-rule.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEHICLE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeRule(type: string, conditions: Record<string, unknown> = {}) {
  return AlarmRule.create('rule-1', {
    tenantId: TENANT,
    name: 'test rule',
    type: type as never,
    severity: 'HIGH',
    enabled: true,
    entityType: 'vehicle',
    entityId: null,
    conditions,
    cooldownSec: 300,
    dedupWindowSec: 600,
    repeatPolicy: 'COOLDOWN',
  });
}

describe('OverspeedEvaluator', () => {
  const eval_ = new OverspeedEvaluator();
  const rule = makeRule('overspeed', { thresholdKmh: 80 });

  it('fires when speed exceeds the threshold', () => {
    const signal: InputSignal = {
      kind: 'position',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      lat: 35,
      lng: 51,
      speedKph: 95,
      headingDeg: 0,
      capturedAt: '2026-01-01T00:00:00Z',
      ignitionOn: true,
    };
    const event = eval_.evaluate(signal, rule);
    expect(event).not.toBeNull();
    expect(event?.type).toBe('overspeed');
    expect(event?.severity).toBe('HIGH');
  });

  it('does NOT fire when speed is at or below the threshold', () => {
    const signal: InputSignal = {
      kind: 'position',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      lat: 35,
      lng: 51,
      speedKph: 80,
      headingDeg: 0,
      capturedAt: '2026-01-01T00:00:00Z',
      ignitionOn: true,
    };
    expect(eval_.evaluate(signal, rule)).toBeNull();
  });

  it('ignores non-position signals', () => {
    const signal: InputSignal = {
      kind: 'device_status',
      tenantId: TENANT,
      deviceId: VEHICLE,
      state: 'OFFLINE',
      lastSeenAt: '2026-01-01T00:00:00Z',
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
      deviceId: VEHICLE,
      state: 'OFFLINE',
      lastSeenAt: '2026-01-01T00:00:00Z',
    };
    const event = eval_.evaluate(signal, rule);
    expect(event).not.toBeNull();
    expect(event?.type).toBe('device_offline');
  });

  it('fires on STALE state', () => {
    const signal: InputSignal = {
      kind: 'device_status',
      tenantId: TENANT,
      deviceId: VEHICLE,
      state: 'STALE',
      lastSeenAt: '2026-01-01T00:00:00Z',
    };
    expect(eval_.evaluate(signal, rule)).not.toBeNull();
  });

  it('does NOT fire on ONLINE state', () => {
    const signal: InputSignal = {
      kind: 'device_status',
      tenantId: TENANT,
      deviceId: VEHICLE,
      state: 'ONLINE',
      lastSeenAt: '2026-01-01T00:00:00Z',
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
        // Simulate Redis SET ... NX: return 'OK' only if the key doesn't exist.
        // The actual call is SET key val EX ttl NX — NX is the last arg.
        const hasNx = opts.includes('NX');
        if (hasNx && stored.has(key)) return null;
        stored.set(key, val);
        return 'OK';
      },
    };
    const { AlarmStateCache } = await import('../infrastructure/cache/alarm-state-cache.js');
    const cache = new AlarmStateCache(fakeRedis as never);
    // First call → not suppressed (key set).
    const first = await cache.shouldSuppress(TENANT, 'rule-1', VEHICLE, 600);
    expect(first).toBe(false);
    // Second call within the window → suppressed (key exists).
    const second = await cache.shouldSuppress(TENANT, 'rule-1', VEHICLE, 600);
    expect(second).toBe(true);
  });
});

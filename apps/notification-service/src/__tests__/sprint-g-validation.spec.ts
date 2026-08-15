/**
 * Sprint G unit suite — consumer boundary validation (Parts 4/21/22) and
 * rule-configuration validation (Part 28).
 *
 * Malformed events must throw EventEnvelopeValidationError (non-retryable →
 * DLQ) and never leak undefined/NaN into rule evaluation. Rule DTOs reject
 * configurations the engine cannot evaluate.
 */
import { describe, expect, it } from '@jest/globals';
import { createRuleSchema } from '../api/notification.dto.js';
import {
  EventEnvelopeValidationError,
  parsePositionSignalEnvelope,
  parseSessionSignalEnvelope,
  parseTrackingEventEnvelope,
} from '../infrastructure/kafka/envelope-validation.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GEOFENCE = '11111111-2222-4333-8444-555555555555';

function positionEnvelope(overrides: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      specversion: '1.0',
      type: 'telemetry.position.raw.v1',
      id: 'msg-1',
      messageId: 'msg-1',
      deviceId: 'dev-1',
      vehicleId: 'veh-1',
      tenantId: TENANT,
      protocolId: 'gt06',
      timestamp: '2026-01-01T00:00:00Z',
      time: '2026-01-01T00:00:01Z',
      position: { latitude: 35.7, longitude: 51.4, speedKph: 90, ignitionOn: true },
      ...overrides,
    }),
  );
}

describe('parsePositionSignalEnvelope (Sprint G Part 4/21)', () => {
  it('parses a valid envelope and prefers the registry-sourced vehicleId', () => {
    const signal = parsePositionSignalEnvelope(positionEnvelope());
    expect(signal.kind).toBe('position');
    expect(signal.vehicleId).toBe('veh-1');
    expect(signal.deviceId).toBe('dev-1');
    expect(signal.sourceEventId).toBe('msg-1');
  });

  it('falls back to deviceId as vehicleId when vehicleId is absent (pre-Sprint-D producers)', () => {
    const signal = parsePositionSignalEnvelope(positionEnvelope({ vehicleId: null }));
    expect(signal.vehicleId).toBe('dev-1');
  });

  it('rejects a missing position object', () => {
    expect(() => parsePositionSignalEnvelope(positionEnvelope({ position: undefined }))).toThrow(
      EventEnvelopeValidationError,
    );
  });

  it('rejects non-finite coordinates', () => {
    const raw = Buffer.from(
      JSON.stringify({
        deviceId: 'dev-1',
        tenantId: TENANT,
        timestamp: '2026-01-01T00:00:00Z',
        position: { latitude: 'x', longitude: 51.4 },
      }),
    );
    expect(() => parsePositionSignalEnvelope(raw)).toThrow(EventEnvelopeValidationError);
  });

  it('rejects an invalid timestamp', () => {
    expect(() =>
      parsePositionSignalEnvelope(positionEnvelope({ timestamp: 'not-a-date' })),
    ).toThrow(EventEnvelopeValidationError);
  });

  it('rejects non-JSON garbage', () => {
    expect(() => parsePositionSignalEnvelope(Buffer.from('{"no'))).toThrow(
      EventEnvelopeValidationError,
    );
    expect(() => parsePositionSignalEnvelope(Buffer.from('[1,2,3]'))).toThrow(
      EventEnvelopeValidationError,
    );
  });
});

describe('parseSessionSignalEnvelope', () => {
  it('parses a lifecycle event', () => {
    const signal = parseSessionSignalEnvelope(
      Buffer.from(
        JSON.stringify({
          sessionId: 's1',
          deviceId: 'dev-1',
          tenantId: TENANT,
          state: 'DISCONNECTED',
          time: '2026-01-01T00:00:00Z',
        }),
      ),
    );
    expect(signal.kind).toBe('device_status');
    // Gateway states are canonicalized (AUTHENTICATED→ONLINE, DISCONNECTED→OFFLINE).
    expect(signal.state).toBe('OFFLINE');
    expect(
      parseSessionSignalEnvelope(
        Buffer.from(
          JSON.stringify({
            sessionId: 's2',
            deviceId: 'dev-1',
            tenantId: TENANT,
            state: 'AUTHENTICATED',
            time: '2026-01-01T00:00:00Z',
          }),
        ),
      ).state,
    ).toBe('ONLINE');
  });

  it('rejects a missing state', () => {
    expect(() =>
      parseSessionSignalEnvelope(
        Buffer.from(JSON.stringify({ deviceId: 'dev-1', tenantId: TENANT })),
      ),
    ).toThrow(EventEnvelopeValidationError);
  });
});

describe('parseTrackingEventEnvelope (FleetEvent topic)', () => {
  function trackingEnvelope(eventType: string, metadata: Record<string, unknown> = {}) {
    return Buffer.from(
      JSON.stringify({
        specversion: '1.0',
        type: 'tracking.event.v1',
        id: 'src-1:trip.started',
        eventId: 'src-1:trip.started',
        eventType,
        tenantId: TENANT,
        vehicleId: 'veh-1',
        occurredAt: '2026-01-01T00:00:00Z',
        metadata,
      }),
    );
  }

  it('parses trip boundary events', () => {
    const signal = parseTrackingEventEnvelope(
      trackingEnvelope('trip.ended', {
        durationSec: 600,
        distanceKm: 10,
        startedAt: '2026-01-01T00:00:00Z',
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.kind).toBe('trip');
    if (signal?.kind === 'trip') {
      expect(signal.durationSec).toBe(600);
      expect(signal.sourceEventId).toBe('src-1:trip.started');
    }
  });

  it('parses idle and parking events', () => {
    expect(
      parseTrackingEventEnvelope(trackingEnvelope('idle.ended', { durationSec: 300 }))?.kind,
    ).toBe('idle');
    expect(
      parseTrackingEventEnvelope(trackingEnvelope('parking.ended', { durationSec: 300 }))?.kind,
    ).toBe('parking');
  });

  it('maps device.online/offline to device_status signals', () => {
    const signal = parseTrackingEventEnvelope(trackingEnvelope('device.offline'));
    expect(signal?.kind).toBe('device_status');
    if (signal?.kind === 'device_status') expect(signal.state).toBe('OFFLINE');
  });

  it('returns null for unknown-but-valid event types (forward-compat)', () => {
    expect(parseTrackingEventEnvelope(trackingEnvelope('fuel.consumed'))).toBeNull();
  });

  it('rejects malformed FleetEvents (missing tenant/vehicle/occurredAt)', () => {
    expect(() =>
      parseTrackingEventEnvelope(Buffer.from(JSON.stringify({ eventType: 'trip.started' }))),
    ).toThrow(EventEnvelopeValidationError);
    expect(() =>
      parseTrackingEventEnvelope(
        Buffer.from(
          JSON.stringify({
            eventId: 'e1',
            eventType: 'trip.started',
            tenantId: TENANT,
            vehicleId: 'veh-1',
            occurredAt: 'garbage',
          }),
        ),
      ),
    ).toThrow(EventEnvelopeValidationError);
  });
});

describe('createRuleSchema — per-type condition validation (Part 28)', () => {
  const base = { name: 'r', severity: 'HIGH' as const };

  it('accepts a valid overspeed rule', () => {
    expect(() =>
      createRuleSchema.parse({ ...base, type: 'overspeed', conditions: { thresholdKmh: 100 } }),
    ).not.toThrow();
  });

  it('accepts the optional overspeed grace period', () => {
    expect(() =>
      createRuleSchema.parse({
        ...base,
        type: 'overspeed',
        conditions: { thresholdKmh: 100, gracePeriodSec: 120 },
      }),
    ).not.toThrow();
  });

  it('rejects overspeed without a threshold', () => {
    expect(() => createRuleSchema.parse({ ...base, type: 'overspeed', conditions: {} })).toThrow();
  });

  it('rejects unknown condition fields (strict)', () => {
    expect(() =>
      createRuleSchema.parse({
        ...base,
        type: 'overspeed',
        conditions: { thresholdKmh: 100, bogus: 1 },
      }),
    ).toThrow();
  });

  it('requires a uuid geofenceId for geofence rules', () => {
    expect(() =>
      createRuleSchema.parse({
        ...base,
        type: 'geofence_enter',
        conditions: { geofenceId: GEOFENCE },
      }),
    ).not.toThrow();
    expect(() =>
      createRuleSchema.parse({
        ...base,
        type: 'geofence_enter',
        conditions: { geofenceId: 'zone-a' },
      }),
    ).toThrow();
    expect(() =>
      createRuleSchema.parse({ ...base, type: 'geofence_exit', conditions: {} }),
    ).toThrow();
  });

  it('requires positive durations for idle/parking/trip-duration rules', () => {
    expect(() =>
      createRuleSchema.parse({
        ...base,
        type: 'prolonged_idle',
        conditions: { minDurationSec: 900 },
      }),
    ).not.toThrow();
    expect(() =>
      createRuleSchema.parse({
        ...base,
        type: 'prolonged_idle',
        conditions: { minDurationSec: 0 },
      }),
    ).toThrow();
  });

  it('rejects rule types with no evaluator (low_battery — no battery telemetry exists)', () => {
    expect(() =>
      createRuleSchema.parse({ ...base, type: 'low_battery', conditions: {} }),
    ).toThrow();
  });

  it('rejects geofence_dwell (dwell evaluation deferred — Sprint G)', () => {
    expect(() =>
      createRuleSchema.parse({
        ...base,
        type: 'geofence_dwell',
        conditions: { geofenceId: GEOFENCE, dwellSec: 300 },
      }),
    ).toThrow();
  });
});

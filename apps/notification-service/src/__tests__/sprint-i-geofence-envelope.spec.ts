/**
 * Sprint I — geofence FleetEvent envelope parsing tests (§61 SECURITY /
 * consumer-boundary validation for the new geofence.entered/exited/dwell
 * event types).
 */
import { describe, expect, it } from '@jest/globals';
import {
  EventEnvelopeValidationError,
  parseTrackingEventEnvelope,
} from '../infrastructure/kafka/envelope-validation.js';

function envelope(eventType: string, metadata: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      specversion: '1.0',
      type: 'tracking.event.v1',
      id: 'evt-1',
      eventId: 'evt-1',
      eventType,
      tenantId: '11111111-1111-4111-8111-111111111111',
      vehicleId: '22222222-2222-4222-8222-222222222222',
      deviceId: null,
      occurredAt: '2026-08-16T10:00:00Z',
      severity: 'INFO',
      metadata,
    }),
  );
}

describe('parseTrackingEventEnvelope — geofence events', () => {
  it('maps geofence.entered → geofence signal with metadata', () => {
    const signal = parseTrackingEventEnvelope(
      envelope('geofence.entered', {
        geofenceId: '33333333-3333-4333-8333-333333333331',
        geofenceName: 'Warehouse',
        lat: 35.72,
        lng: 51.42,
      }),
    );
    expect(signal).not.toBeNull();
    expect(signal?.kind).toBe('geofence');
    if (signal?.kind === 'geofence') {
      expect(signal.type).toBe('geofence.entered');
      expect(signal.geofenceId).toBe('33333333-3333-4333-8333-333333333331');
      expect(signal.geofenceName).toBe('Warehouse');
      expect(signal.dwellSec).toBeNull();
      expect(signal.lat).toBeCloseTo(35.72);
      expect(signal.sourceEventId).toBe('evt-1');
    }
  });

  it('maps geofence.dwell with the elapsed dwellSec', () => {
    const signal = parseTrackingEventEnvelope(
      envelope('geofence.dwell', { geofenceId: 'g1', dwellSec: 720 }),
    );
    expect(signal?.kind).toBe('geofence');
    if (signal?.kind === 'geofence') {
      expect(signal.type).toBe('geofence.dwell');
      expect(signal.dwellSec).toBe(720);
    }
  });

  it('maps geofence.exited', () => {
    const signal = parseTrackingEventEnvelope(envelope('geofence.exited', { geofenceId: 'g1' }));
    expect(signal?.kind).toBe('geofence');
  });

  it('still returns null for unknown (not alarm-relevant) event types', () => {
    expect(parseTrackingEventEnvelope(envelope('something.else'))).toBeNull();
  });

  it('malformed envelopes throw EventEnvelopeValidationError (→ DLQ, never NaN)', () => {
    expect(() => parseTrackingEventEnvelope(Buffer.from('not json'))).toThrow(
      EventEnvelopeValidationError,
    );
    expect(() =>
      parseTrackingEventEnvelope(
        Buffer.from(JSON.stringify({ eventType: 'geofence.entered' })),
      ),
    ).toThrow(EventEnvelopeValidationError);
  });

  it('missing geofenceId degrades to null (rule matching handles it)', () => {
    const signal = parseTrackingEventEnvelope(envelope('geofence.entered', {}));
    expect(signal?.kind).toBe('geofence');
    if (signal?.kind === 'geofence') expect(signal.geofenceId).toBeNull();
  });
});

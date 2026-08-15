import { describe, expect, it } from '@jest/globals';
import {
  EnvelopeValidationError,
  parsePositionEnvelope,
} from '../infrastructure/kafka/envelope-parser.js';

/**
 * Sprint D §18/§22 — consumer-boundary validation. A malformed event must be
 * classified non-retryable (EnvelopeValidationError → DLQ), and timestamps must
 * be strictly validated (an Invalid Date previously sailed through quality
 * validation as NaN comparisons and got persisted as VALID).
 */

function baseEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    specversion: '1.0',
    type: 'telemetry.position.raw.v1',
    id: '01986e11-aaaa-7000-8000-000000000001',
    messageId: '01986e11-aaaa-7000-8000-000000000001',
    correlationId: 'session-1',
    deviceId: '11111111-1111-1111-1111-111111111111',
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    vehicleId: '22222222-2222-2222-2222-222222222222',
    protocolId: 'gt06',
    timestamp: '2026-08-14T10:00:00Z',
    time: '2026-08-14T10:00:01Z',
    position: { latitude: 35.7, longitude: 51.4, speedKph: 40, headingDeg: 90 },
    ...overrides,
  });
}

describe('Sprint D §5 — trusted vehicleId propagation', () => {
  it('uses the registry-sourced vehicleId when the gateway provides one', () => {
    const event = parsePositionEnvelope(baseEnvelope());
    expect(event.vehicleId).toBe('22222222-2222-2222-2222-222222222222');
    expect(event.messageId).toBe('01986e11-aaaa-7000-8000-000000000001');
  });

  it('falls back to deviceId for pre-Sprint-D envelopes (backward compatible)', () => {
    const event = parsePositionEnvelope(baseEnvelope({ vehicleId: null }));
    expect(event.vehicleId).toBe('11111111-1111-1111-1111-111111111111');
  });
});

describe('Sprint D §22 — strict timestamp validation', () => {
  it('rejects an unparseable device timestamp (was: Invalid Date → VALID)', () => {
    expect(() => parsePositionEnvelope(baseEnvelope({ timestamp: 'garbage' }))).toThrow(
      EnvelopeValidationError,
    );
    expect(() => parsePositionEnvelope(baseEnvelope({ timestamp: 'garbage' }))).toThrow(
      /timestamp/,
    );
  });

  it('rejects a non-string timestamp', () => {
    expect(() =>
      parsePositionEnvelope(baseEnvelope({ timestamp: { nested: true } })),
    ).toThrow(EnvelopeValidationError);
  });

  it('rejects an unparseable ingestion time', () => {
    expect(() => parsePositionEnvelope(baseEnvelope({ time: 'not-a-date' }))).toThrow(
      EnvelopeValidationError,
    );
  });

  it('event time and ingestion time are BOTH preserved (never overwritten)', () => {
    const event = parsePositionEnvelope(baseEnvelope());
    expect(event.capturedAt.toISOString()).toBe('2026-08-14T10:00:00.000Z');
    expect(event.ingestedAt.toISOString()).toBe('2026-08-14T10:00:01.000Z');
  });
});

describe('Sprint D §18 — structural validation (non-retryable)', () => {
  it('rejects invalid JSON', () => {
    expect(() => parsePositionEnvelope('not-json{')).toThrow(EnvelopeValidationError);
  });

  it('rejects a non-object envelope', () => {
    expect(() => parsePositionEnvelope('[1,2,3]')).toThrow(EnvelopeValidationError);
    expect(() => parsePositionEnvelope('null')).toThrow(EnvelopeValidationError);
  });

  it('rejects missing identity fields', () => {
    expect(() => parsePositionEnvelope(baseEnvelope({ messageId: undefined, id: undefined }))).toThrow(
      /messageId/,
    );
    expect(() => parsePositionEnvelope(baseEnvelope({ deviceId: undefined }))).toThrow(/deviceId/);
    expect(() => parsePositionEnvelope(baseEnvelope({ tenantId: '' }))).toThrow(/tenantId/);
  });

  it('rejects missing / non-numeric / non-finite coordinates', () => {
    expect(() => parsePositionEnvelope(baseEnvelope({ position: undefined }))).toThrow(/position/);
    expect(() =>
      parsePositionEnvelope(baseEnvelope({ position: { latitude: 'x', longitude: 1 } })),
    ).toThrow(/latitude/);
    // JSON.stringify(Infinity) → null: serializes into the missing-numeric branch.
    expect(() =>
      parsePositionEnvelope(baseEnvelope({ position: { latitude: Infinity, longitude: 1 } })),
    ).toThrow(EnvelopeValidationError);
  });
});

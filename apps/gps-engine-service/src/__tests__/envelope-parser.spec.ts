import { describe, expect, it } from '@jest/globals';
import { mapSessionState } from '../domain/device-status.js';
import {
  parsePositionEnvelope,
  parseSessionEnvelope,
} from '../infrastructure/kafka/envelope-parser.js';

const NOW = '2026-08-06T10:00:00Z';

/** Build a CloudEvents envelope matching the device-gateway's toEnvelope shape. */
function positionEnvelope(opts: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    specversion: '1.0',
    type: 'telemetry.position.raw.v1',
    time: NOW,
    id: opts.messageId ?? 'msg-001',
    messageId: opts.messageId ?? 'msg-001',
    deviceId: opts.deviceId ?? 'dev-001',
    tenantId: opts.tenantId ?? 'tenant-001',
    protocolId: opts.protocolId ?? 'gt06',
    messageType: 'POSITION',
    timestamp: opts.timestamp ?? NOW,
    position: opts.position ?? {
      latitude: 22.9382,
      longitude: 113.3827,
      speedKph: 42,
      headingDeg: 180,
      altitudeM: 55,
      satellites: 8,
      ignitionOn: true,
    },
    ...opts,
  });
}

describe('parsePositionEnvelope', () => {
  it('parses a valid CloudEvents envelope into a PositionEvent', () => {
    const event = parsePositionEnvelope(positionEnvelope());
    expect(event.messageId).toBe('msg-001');
    expect(event.vehicleId).toBe('dev-001'); // deviceId → vehicleId (Sprint 7)
    expect(event.tenantId).toBe('tenant-001');
    expect(event.latitude).toBeCloseTo(22.9382, 4);
    expect(event.longitude).toBeCloseTo(113.3827, 4);
    expect(event.speedKph).toBe(42);
    expect(event.headingDeg).toBe(180);
    expect(event.altitudeM).toBe(55);
    expect(event.ignitionOn).toBe(true);
    expect(event.capturedAt.toISOString()).toBe(new Date(NOW).toISOString());
    expect(event.protocolId).toBe('gt06');
    expect(event.quality).toBe('VALID');
  });

  it('falls back to `id` when `messageId` is absent', () => {
    const { messageId: _omit, ...env } = JSON.parse(positionEnvelope());
    void _omit;
    const event = parsePositionEnvelope(JSON.stringify(env));
    expect(event.messageId).toBe('msg-001');
  });

  it('throws on a missing position', () => {
    const { position: _omit, ...env } = JSON.parse(positionEnvelope());
    void _omit;
    expect(() => parsePositionEnvelope(JSON.stringify(env))).toThrow(/position/);
  });

  it('throws on a missing deviceId', () => {
    const { deviceId: _omit, ...env } = JSON.parse(positionEnvelope());
    void _omit;
    expect(() => parsePositionEnvelope(JSON.stringify(env))).toThrow(/deviceId/);
  });

  it('defaults speed/heading to 0 when absent', () => {
    const env = JSON.parse(positionEnvelope());
    const { speedKph: _s, headingDeg: _h, ...posRest } = env.position;
    void _s;
    void _h;
    const event = parsePositionEnvelope(JSON.stringify({ ...env, position: posRest }));
    expect(event.speedKph).toBe(0);
    expect(event.headingDeg).toBe(0);
  });
});

describe('parseSessionEnvelope', () => {
  function sessionEnvelope(state: string): string {
    return JSON.stringify({
      specversion: '1.0',
      type: 'telemetry.session.lifecycle.v1',
      time: NOW,
      sessionId: 'sess-1',
      deviceId: 'dev-001',
      tenantId: 'tenant-001',
      state,
      reason: 'IDLE_TIMEOUT',
      protocolId: 'gt06',
    });
  }

  it('maps AUTHENTICATED → ONLINE', () => {
    const rec = parseSessionEnvelope(sessionEnvelope('AUTHENTICATED'));
    expect(rec.state).toBe('ONLINE');
    expect(rec.deviceId).toBe('dev-001');
  });

  it('maps DISCONNECTED → OFFLINE', () => {
    expect(parseSessionEnvelope(sessionEnvelope('DISCONNECTED')).state).toBe('OFFLINE');
  });

  it('maps CLOSED → OFFLINE', () => {
    expect(parseSessionEnvelope(sessionEnvelope('CLOSED')).state).toBe('OFFLINE');
  });

  it('maps STALE → STALE', () => {
    expect(parseSessionEnvelope(sessionEnvelope('STALE')).state).toBe('STALE');
  });

  it('throws on missing state', () => {
    const { state: _omit, ...env } = JSON.parse(sessionEnvelope('AUTHENTICATED'));
    void _omit;
    expect(() => parseSessionEnvelope(JSON.stringify(env))).toThrow(/state/);
  });
});

describe('mapSessionState (direct)', () => {
  it('maps ACTIVE and IDENTIFY to ONLINE', () => {
    expect(mapSessionState('ACTIVE')).toBe('ONLINE');
    expect(mapSessionState('IDENTIFY')).toBe('ONLINE');
  });
  it('defaults unknown states to OFFLINE (fail-safe)', () => {
    expect(mapSessionState('UNKNOWN')).toBe('OFFLINE');
  });
});

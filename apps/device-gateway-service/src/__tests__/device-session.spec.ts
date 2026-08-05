import { describe, expect, it } from '@jest/globals';
import {
  AuthError,
  DeviceSession,
  IllegalSessionTransitionError,
  ProtocolError,
  SessionInvariantError,
  asSessionId,
} from '../domain/index.js';

const NOW = new Date('2026-08-05T10:00:00Z');
function tick(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

function newSession(): DeviceSession {
  return DeviceSession.open({
    transport: 'tcp',
    protocolId: 'gt06',
    remoteAddress: '10.0.0.1',
    remotePort: 40000,
    instanceId: 'pod-a',
    now: NOW,
  });
}

describe('DeviceSession lifecycle (06 §6.1)', () => {
  it('opens in NEW and is live', () => {
    const s = newSession();
    expect(s.state).toBe('NEW');
    expect(s.isLive).toBe(true);
    expect(s.deviceId).toBeNull();
    expect(s.tenantId).toBeNull();
    expect(s.closeReason).toBeNull();
  });

  it('transitions NEW → IDENTIFY → AUTHENTICATED → ACTIVE on the happy path', () => {
    const s = newSession();
    s.identify(tick(1));
    expect(s.state).toBe('IDENTIFY');
    s.authenticate({ deviceId: 'dev-1', tenantId: 't-1', serialOrImei: 'imei-1', now: tick(2) });
    expect(s.state).toBe('AUTHENTICATED');
    expect(s.deviceId).toBe('dev-1');
    expect(s.tenantId).toBe('t-1');
    expect(s.serialOrImei).toBe('imei-1');
    s.activate(tick(3));
    expect(s.state).toBe('ACTIVE');
    expect(s.firstDataAt).toEqual(tick(3));
  });

  it('re-stamps lastSeenAt on every transition and touch', () => {
    const s = newSession();
    expect(s.lastSeenAt).toEqual(NOW);
    s.identify(tick(5));
    expect(s.lastSeenAt).toEqual(tick(5));
    s.touch(tick(10));
    expect(s.lastSeenAt).toEqual(tick(10));
  });

  it('activate is idempotent when already ACTIVE', () => {
    const s = newSession();
    s.identify();
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i' });
    s.activate(tick(3));
    const first = s.firstDataAt;
    s.activate(tick(9));
    expect(s.state).toBe('ACTIVE');
    expect(s.firstDataAt).toBe(first); // firstDataAt is the *first* useful payload
    expect(s.lastSeenAt).toEqual(tick(9));
  });
});

describe('DeviceSession illegal transitions', () => {
  it('rejects authenticate from NEW (must identify first)', () => {
    const s = newSession();
    expect(() => s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i' })).toThrow(
      IllegalSessionTransitionError,
    );
  });

  it('rejects activate before authenticate', () => {
    const s = newSession();
    s.identify();
    expect(() => s.activate()).toThrow(IllegalSessionTransitionError);
  });

  it('rejects identify from AUTHENTICATED', () => {
    const s = newSession();
    s.identify();
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i' });
    expect(() => s.identify()).toThrow(IllegalSessionTransitionError);
  });
});

describe('DeviceSession teardown paths', () => {
  it('NEW → CLOSING (protocol error) → CLOSED', () => {
    const s = newSession();
    s.beginClosing('PROTOCOL_ERROR', tick(1));
    expect(s.state).toBe('CLOSING');
    expect(s.closeReason).toBe('PROTOCOL_ERROR');
    expect(s.isLive).toBe(false);
    s.close(tick(2));
    expect(s.state).toBe('CLOSED');
  });

  it('ACTIVE → DISCONNECTED (idle) → CLOSED', () => {
    const s = newSession();
    s.identify();
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i' });
    s.activate();
    s.disconnect('IDLE_TIMEOUT', tick(100));
    expect(s.state).toBe('DISCONNECTED');
    expect(s.closeReason).toBe('IDLE_TIMEOUT');
    s.close();
    expect(s.state).toBe('CLOSED');
  });

  it('NEW → DISCONNECTED routes through CLOSING (unauthenticated)', () => {
    const s = newSession();
    s.disconnect('REMOTE_DISCONNECT');
    expect(s.state).toBe('DISCONNECTED');
    expect(s.closeReason).toBe('REMOTE_DISCONNECT');
  });

  it('close is idempotent on an already-closed session', () => {
    const s = newSession();
    s.close();
    expect(s.state).toBe('CLOSED');
    s.close(); // no throw
  });

  it('beginClosing on a terminal session records the reason without throwing', () => {
    const s = newSession();
    s.close();
    expect(() => s.beginClosing('ADMIN')).not.toThrow();
    expect(s.closeReason).toBe('ADMIN');
  });
});

describe('DeviceSession invariants (06 §6.1)', () => {
  it('#1 canPublish is false until AUTHENTICATED, true after', () => {
    const s = newSession();
    expect(s.canPublish()).toBe(false);
    s.identify();
    expect(s.canPublish()).toBe(false);
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i' });
    expect(s.canPublish()).toBe(true);
    s.activate();
    expect(s.canPublish()).toBe(true);
    s.disconnect('IDLE_TIMEOUT');
    expect(s.canPublish()).toBe(false);
  });

  it('#1 assertCanPublish throws SessionInvariantError pre-auth (fail-closed)', () => {
    const s = newSession();
    expect(() => s.assertCanPublish()).toThrow(SessionInvariantError);
    s.identify();
    expect(() => s.assertCanPublish()).toThrow(SessionInvariantError);
  });

  it('#2 canDispatchCommand only for AUTHENTICATED/ACTIVE', () => {
    const s = newSession();
    s.identify();
    expect(s.canDispatchCommand()).toBe(false); // IDENTIFY — no
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i' });
    expect(s.canDispatchCommand()).toBe(true);
    s.activate();
    expect(s.canDispatchCommand()).toBe(true);
    s.disconnect('IDLE_TIMEOUT');
    expect(s.canDispatchCommand()).toBe(false);
  });

  it('#3 rehydrate preserves a stable session id', () => {
    const id = asSessionId('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa');
    const s = DeviceSession.rehydrate(id, {
      transport: 'tcp',
      protocolId: 'gt06',
      remoteAddress: '1.2.3.4',
      remotePort: 9,
      instanceId: 'pod-a',
      createdAt: NOW,
      state: 'ACTIVE',
      lastSeenAt: NOW,
      deviceId: 'd',
      tenantId: 't',
      serialOrImei: 'i',
      firstDataAt: NOW,
      lastDataAt: NOW,
      closeReason: null,
    });
    expect(s.id).toBe(id);
    expect(s.state).toBe('ACTIVE');
    const snap = s.toSnapshot();
    expect(snap.sessionId).toBe(id);
    expect(snap.deviceId).toBe('d');
    expect(snap.since).toBe(NOW.toISOString());
  });
});

describe('DeviceSession error subtypes', () => {
  it('ProtocolError carries the protocol id', () => {
    const e = new ProtocolError('bad crc', 'gt06');
    expect(e.protocolId).toBe('gt06');
    expect(e.code).toBe('DEVICE_PROTOCOL_ERROR');
  });

  it('AuthError derives its code from the outcome (06 §7.3)', () => {
    expect(new AuthError('no', 'unknown').code).toBe('DEVICE_AUTH_UNKNOWN');
    expect(new AuthError('no', 'disabled').outcome).toBe('disabled');
    expect(new AuthError('no', 'tenant_suspended').code).toBe('DEVICE_AUTH_TENANT_SUSPENDED');
    expect(new AuthError('no', 'unreachable').code).toBe('DEVICE_AUTH_UNREACHABLE');
  });
});

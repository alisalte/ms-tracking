import { describe, expect, it } from '@jest/globals';
import { DeviceSession, HeartbeatPolicy, type Transport } from '../domain/index.js';

const NOW = new Date('2026-08-05T10:00:00Z');
function at(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

function open(transport: Transport = 'tcp', protocolId = 'gt06'): DeviceSession {
  return DeviceSession.open({
    transport,
    protocolId,
    remoteAddress: '10.0.0.1',
    remotePort: 40000,
    instanceId: 'pod-a',
    now: NOW,
  });
}

const policy = new HeartbeatPolicy({
  tcpIdleTimeoutMs: 180_000,
  udpSessionTtlMs: 30_000,
  authGraceMs: 10_000,
  staleFactor: 3,
  defaultReportingIntervalMs: 10_000,
});

describe('HeartbeatPolicy — auth grace (06 §12.4)', () => {
  it('a NEW session within the grace is not timed out', () => {
    const s = open();
    expect(policy.evaluate(s, at(5_000))).toEqual({ timedOut: false, reason: null });
  });

  it('a NEW session older than authGrace → AUTH_GRACE', () => {
    const s = open();
    expect(policy.evaluate(s, at(11_000))).toEqual({ timedOut: true, reason: 'AUTH_GRACE' });
  });

  it('an IDENTIFY session past grace is also closed (unauthenticated)', () => {
    const s = open();
    s.identify(at(1_000));
    expect(policy.evaluate(s, at(20_000))).toEqual({ timedOut: true, reason: 'AUTH_GRACE' });
  });
});

describe('HeartbeatPolicy — TCP idle timeout (06 §12.2)', () => {
  it('an ACTIVE TCP session reporting useful data stays alive', () => {
    const s = open('tcp');
    s.identify();
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i', now: at(1_000) });
    s.activate(at(2_000));
    s.recordData(at(50_000)); // last useful payload 50s; staleAfter = 30s from that = 80s
    expect(policy.evaluate(s, at(60_000))).toEqual({ timedOut: false, reason: null });
  });

  it('an authenticated TCP session silent beyond idle timeout → IDLE_TIMEOUT', () => {
    const s = open('tcp');
    s.identify();
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i', now: at(1_000) });
    // lastSeen ~ 1s; tcpIdleTimeout = 180s. At 181s since lastSeen → IDLE_TIMEOUT
    // (checked before STALE_DATA, per 06 §12.4 — connection liveness first).
    expect(policy.evaluate(s, at(182_000))).toEqual({ timedOut: true, reason: 'IDLE_TIMEOUT' });
  });

  it('an ACTIVE TCP session kept alive with heartbeats but no useful data → STALE_DATA', () => {
    const s = open('tcp');
    s.identify();
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i', now: at(1_000) });
    s.activate(at(2_000)); // lastDataAt = 2s
    // Keep the connection alive (touch every 10s) so IDLE_TIMEOUT never fires,
    // but produce no further useful data → data-liveness trips at 3*10s = 30s.
    s.touch(at(20_000));
    expect(policy.evaluate(s, at(33_000))).toEqual({ timedOut: true, reason: 'STALE_DATA' });
  });
});

describe('HeartbeatPolicy — UDP pseudo-session TTL (06 §4.4)', () => {
  it('a UDP session past its TTL → TTL_EXPIRED', () => {
    const s = open('udp');
    s.identify();
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i', now: at(1_000) });
    s.touch(at(5_000));
    // TTL is 30s; at 40s since lastSeen it has expired.
    expect(policy.evaluate(s, at(40_000))).toEqual({ timedOut: true, reason: 'TTL_EXPIRED' });
  });
});

describe('HeartbeatPolicy — data liveness / STALE_DATA (06 §12.1)', () => {
  it('an authenticated session with no useful data beyond staleFactor*interval → STALE_DATA', () => {
    const s = open('udp'); // small TTL won't matter — we evaluate before TTL
    s.identify();
    // authenticated but never activated (firstDataAt null); age ~ since createdAt.
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i', now: at(1_000) });
    s.touch(at(5_000)); // keep "lastSeen" fresh so TTL/idle don't fire
    // staleAfter = 3 * 10s = 30s. now=31s, lastSeen=5s (fresh), but sinceData ~ age.
    const d = policy.evaluate(s, at(31_000));
    expect(d.timedOut).toBe(true);
    expect(d.reason).toBe('STALE_DATA');
  });
});

describe('HeartbeatPolicy — terminal sessions', () => {
  it('never times out a CLOSED session', () => {
    const s = open();
    s.close();
    expect(policy.evaluate(s, at(1_000_000))).toEqual({ timedOut: false, reason: null });
  });

  it('never times out a DISCONNECTED session', () => {
    const s = open();
    s.identify();
    s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i' });
    s.disconnect('IDLE_TIMEOUT');
    expect(policy.evaluate(s, at(1_000_000))).toEqual({ timedOut: false, reason: null });
  });
});

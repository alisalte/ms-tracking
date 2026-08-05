import { beforeEach, describe, expect, it } from '@jest/globals';
import { ConnectionPool } from '../application/connection-pool.js';
import { DeviceSession } from '../domain/index.js';

const NOW = new Date('2026-08-05T10:00:00Z');
function at(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

function openSession(state: DeviceSession['state'] = 'NEW'): DeviceSession {
  const s = DeviceSession.open({
    transport: 'tcp',
    protocolId: 'gt06',
    remoteAddress: '1.2.3.4',
    remotePort: 5000,
    instanceId: 'pod-a',
    now: NOW,
  });
  if (state === 'NEW') return s;
  s.identify();
  if (state === 'IDENTIFY') return s;
  s.authenticate({ deviceId: 'd', tenantId: 't', serialOrImei: 'i' });
  if (state === 'AUTHENTICATED') return s;
  s.activate();
  if (state === 'ACTIVE') return s;
  return s;
}

describe('ConnectionPool admission + back-pressure (06 §5)', () => {
  let pool: ConnectionPool;
  beforeEach(() => {
    pool = new ConnectionPool({
      maxConnections: 3,
      reportingIntervalMs: 10_000,
      evictionThreshold: 2,
    });
  });

  it('admits sessions until the cap, then rejects (back-pressure, not drop)', () => {
    const a = openSession();
    const b = openSession();
    const c = openSession();
    const d = openSession();
    expect(pool.admit(a)).toBe(true);
    expect(pool.admit(b)).toBe(true);
    expect(pool.admit(c)).toBe(true);
    expect(pool.admit(d)).toBe(false); // hard cap
    const p = pool.pressure();
    expect(p.active).toBe(3);
    expect(p.full).toBe(true);
    expect(p.saturated).toBe(true);
  });

  it('release frees capacity', () => {
    const a = openSession();
    pool.admit(a);
    pool.release(a.id as string);
    expect(pool.active).toBe(0);
    expect(pool.pressure().full).toBe(false);
  });

  it('reports saturation at the eviction threshold before full', () => {
    const pool2 = new ConnectionPool({
      maxConnections: 100,
      reportingIntervalMs: 10_000,
      evictionThreshold: 50,
    });
    for (let i = 0; i < 50; i++) pool2.admit(openSession());
    expect(pool2.pressure().saturated).toBe(true);
    expect(pool2.pressure().full).toBe(false);
  });
});

describe('ConnectionPool eviction policy (06 §5.2)', () => {
  it('picks NEW unauthenticated sessions past auth-grace first', () => {
    const pool = new ConnectionPool({
      maxConnections: 100,
      reportingIntervalMs: 10_000,
      evictionThreshold: 1,
    });
    const stale = openSession('NEW');
    pool.admit(stale);
    const fresh = DeviceSession.open({
      transport: 'tcp',
      protocolId: 'gt06',
      remoteAddress: '1.2.3.4',
      remotePort: 5001,
      instanceId: 'pod-a',
      now: at(5_000),
    });
    pool.admit(fresh);
    const candidates = pool.pickEvictionCandidates(at(15_000), 10_000, 5);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sessionId).toBe(stale.id);
    expect(candidates[0]?.reason).toBe('NEW_UNAUTHENTICATED');
  });

  it('never evicts authenticated sessions that have produced data', () => {
    const pool = new ConnectionPool({
      maxConnections: 100,
      reportingIntervalMs: 10_000,
      evictionThreshold: 1,
    });
    const active = openSession('ACTIVE');
    pool.admit(active);
    const candidates = pool.pickEvictionCandidates(at(1_000_000), 10_000, 5);
    expect(candidates).toHaveLength(0);
  });

  it('picks no-data authenticated sessions beyond 3x reporting interval', () => {
    const pool = new ConnectionPool({
      maxConnections: 100,
      reportingIntervalMs: 10_000,
      evictionThreshold: 1,
    });
    const authedNoData = openSession('AUTHENTICATED'); // authenticated, never activated
    pool.admit(authedNoData);
    const candidates = pool.pickEvictionCandidates(at(40_000), 10_000, 5);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.reason).toBe('NO_DATA');
  });

  it('respects the max-candidates limit', () => {
    const pool = new ConnectionPool({
      maxConnections: 100,
      reportingIntervalMs: 10_000,
      evictionThreshold: 1,
    });
    for (let i = 0; i < 5; i++) pool.admit(openSession('NEW'));
    const candidates = pool.pickEvictionCandidates(at(15_000), 10_000, 2);
    expect(candidates).toHaveLength(2);
  });

  it('snapshot lists tracked sessions for the admin API', () => {
    const pool = new ConnectionPool({
      maxConnections: 100,
      reportingIntervalMs: 10_000,
      evictionThreshold: 1,
    });
    pool.admit(openSession('NEW'));
    pool.admit(openSession('ACTIVE'));
    expect(pool.snapshot()).toHaveLength(2);
    expect(pool.snapshot().every((s) => typeof s.sessionId === 'string')).toBe(true);
  });
});

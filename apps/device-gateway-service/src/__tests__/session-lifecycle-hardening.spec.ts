import { beforeEach, describe, expect, it } from '@jest/globals';
import { type SessionLifecycleEmitter, SessionManager } from '../application/session-manager.js';
import { DeviceSession } from '../domain/index.js';
import type { SessionRedisStore } from '../infrastructure/storage/session-redis-store.js';

/**
 * Sprint D §7/§8 — duplicate-connection enforcement + liveness sweep.
 *
 *   Device A → Connection 1, then Device A → Connection 2:
 *   the NEW connection replaces the OLD (newest wins) — the prior local
 *   session is closed with DUPLICATE_SESSION and its socket terminator fires;
 *   cross-instance, the prior pod detects supersession in `sweep()` when the
 *   Redis snapshot no longer names its session id.
 */
const NOW = new Date('2026-08-14T10:00:00Z');
const LATER = new Date('2026-08-14T10:00:30Z');

class RecordingEmitter implements SessionLifecycleEmitter {
  public readonly events: {
    state: string;
    sessionId: string;
    deviceId: string | null;
    reason: string | null;
  }[] = [];
  async publishSessionLifecycle(e: {
    sessionId: string;
    state: string;
    deviceId: string | null;
    reason: string | null;
  }): Promise<void> {
    this.events.push({
      state: e.state,
      sessionId: e.sessionId,
      deviceId: e.deviceId,
      reason: e.reason,
    });
  }
}

/** In-memory stand-in for the Redis session store. */
class FakeRedisStore {
  public entries = new Map<string, { instanceID: string; sessionID: string }>();
  public removedKeys: string[] = [];
  public failReads = false;

  private key(tenantId: string, deviceId: string): string {
    return `tenant:${tenantId}:device:${deviceId}:session`;
  }

  async upsert(
    tenantId: string,
    deviceId: string,
    value: { instanceID: string; sessionID: string },
  ): Promise<{ displaced: boolean }> {
    const k = this.key(tenantId, deviceId);
    const prev = this.entries.get(k);
    this.entries.set(k, value);
    return { displaced: prev !== undefined && prev.instanceID !== value.instanceID };
  }

  async get(tenantId: string, deviceId: string) {
    if (this.failReads) throw new Error('redis down');
    return this.entries.get(this.key(tenantId, deviceId)) ?? null;
  }

  async remove(tenantId: string, deviceId: string) {
    this.entries.delete(this.key(tenantId, deviceId));
  }

  async removeIfSession(tenantId: string, deviceId: string, sessionId: string) {
    const k = this.key(tenantId, deviceId);
    const current = this.entries.get(k);
    if (current && current.sessionID !== sessionId) return; // not ours anymore
    this.removedKeys.push(k);
    this.entries.delete(k);
  }

  async upsertSnapshot(
    snapshot: { tenantId: string | null; deviceId: string | null; sessionId: string },
    _ttl: number,
    instanceId: string,
  ) {
    if (!snapshot.tenantId || !snapshot.deviceId) return { displaced: false };
    return this.upsert(snapshot.tenantId, snapshot.deviceId, {
      instanceID: instanceId,
      sessionID: snapshot.sessionId,
    });
  }
}

function openAndAuthenticate(
  deviceId: string,
  opts: { transport?: 'tcp' | 'udp'; instanceId?: string; now?: Date; imei?: string } = {},
): DeviceSession {
  const s = DeviceSession.open({
    transport: opts.transport ?? 'tcp',
    protocolId: 'gt06',
    remoteAddress: '1.2.3.4',
    remotePort: 5000,
    instanceId: opts.instanceId ?? 'pod-a',
    now: opts.now ?? NOW,
  });
  s.identify(opts.now ?? NOW);
  s.authenticate({
    deviceId,
    tenantId: 'tenant-1',
    serialOrImei: opts.imei ?? `imei-${deviceId}`,
    vehicleId: 'vehicle-1',
    now: opts.now ?? NOW,
  });
  return s;
}

function makeManager(store: FakeRedisStore | null, emitter: RecordingEmitter) {
  return new SessionManager(store as unknown as SessionRedisStore | null, emitter, 'pod-a', {
    tcpTtlSeconds: 60,
    udpTtlSeconds: 30,
    authGraceMs: 15_000,
    supersededCheckIntervalMs: 0,
  });
}

describe('Sprint D §8 — duplicate device connection (newest wins)', () => {
  let emitter: RecordingEmitter;
  let manager: SessionManager;

  beforeEach(() => {
    emitter = new RecordingEmitter();
    manager = makeManager(null, emitter);
  });

  it('a second connection for the same device closes the first with DUPLICATE_SESSION', async () => {
    const terminated: string[] = [];
    const first = openAndAuthenticate('dev-1');
    manager.track(first);
    manager.registerTerminator(first.id as string, () => terminated.push(first.id as string));
    await manager.registerAuthenticated(first);

    const second = openAndAuthenticate('dev-1', { now: LATER });
    manager.track(second);
    await manager.registerAuthenticated(second);

    // Old session: closed + terminated; the byDevice index now names the new one.
    expect(first.state).toBe('CLOSED');
    expect(first.closeReason).toBe('DUPLICATE_SESSION');
    expect(terminated).toEqual([first.id as string]);
    expect(manager.byDeviceId('dev-1')).toBe(second);
    // Exactly ONE DISCONNECTED for the old session, ONE AUTHENTICATED for the new.
    const oldDisconnected = emitter.events.filter(
      (e) => e.sessionId === first.id && e.state === 'DISCONNECTED',
    );
    expect(oldDisconnected).toHaveLength(1);
    expect(oldDisconnected[0]?.reason).toBe('DUPLICATE_SESSION');
    expect(
      emitter.events.filter((e) => e.sessionId === second.id && e.state === 'AUTHENTICATED'),
    ).toHaveLength(1);
  });

  it('closing an already-closed session does not emit a second DISCONNECTED', async () => {
    const s = openAndAuthenticate('dev-2');
    manager.track(s);
    await manager.registerAuthenticated(s);
    await manager.close(s, 'DUPLICATE_SESSION'); // manager-initiated
    await manager.close(s, 'REMOTE_DISCONNECT'); // late socket cleanup
    expect(
      emitter.events.filter((e) => e.sessionId === s.id && e.state === 'DISCONNECTED'),
    ).toHaveLength(1);
  });

  it('a duplicate connection for a DIFFERENT device does not close the first', async () => {
    const a = openAndAuthenticate('dev-a');
    manager.track(a);
    await manager.registerAuthenticated(a);
    const b = openAndAuthenticate('dev-b');
    manager.track(b);
    await manager.registerAuthenticated(b);
    expect(a.state).toBe('AUTHENTICATED');
    expect(manager.byDeviceId('dev-a')).toBe(a);
    expect(manager.byDeviceId('dev-b')).toBe(b);
  });
});

describe('Sprint D §7 — liveness sweep', () => {
  it('closes unauthenticated sessions past the auth grace', async () => {
    const emitter = new RecordingEmitter();
    const manager = makeManager(null, emitter);
    const fresh = DeviceSession.open({
      transport: 'tcp',
      protocolId: 'gt06',
      remoteAddress: '1.1.1.1',
      remotePort: 1,
      instanceId: 'pod-a',
      now: LATER,
    });
    const stale = DeviceSession.open({
      transport: 'tcp',
      protocolId: 'gt06',
      remoteAddress: '2.2.2.2',
      remotePort: 2,
      instanceId: 'pod-a',
      now: NOW, // 30s old, grace is 15s
    });
    manager.track(fresh);
    manager.track(stale);

    const result = await manager.sweep(LATER);
    expect(result.closedAuthGrace).toBe(1);
    expect(stale.state).toBe('CLOSED');
    expect(stale.closeReason).toBe('IDLE_TIMEOUT');
    expect(fresh.isLive).toBe(true);
  });

  it('closes UDP pseudo-sessions idle past their TTL', async () => {
    const emitter = new RecordingEmitter();
    const manager = makeManager(null, emitter);
    const udp = openAndAuthenticate('dev-udp', { transport: 'udp', now: NOW });
    manager.track(udp);
    await manager.registerAuthenticated(udp);

    // 31s later (UDP TTL 30s): swept.
    const result = await manager.sweep(new Date(NOW.getTime() + 31_000));
    expect(result.closedUdpTtl).toBe(1);
    expect(udp.closeReason).toBe('TTL_EXPIRED');
  });

  it('reuses the live UDP pseudo-session for the same source (no per-datagram leak)', () => {
    const emitter = new RecordingEmitter();
    const manager = makeManager(null, emitter);
    const first = openAndAuthenticate('dev-udp-2', { transport: 'udp' });
    manager.track(first);

    const reused = manager.udpSessionFor('gt06', '1.2.3.4', 5000);
    expect(reused).toBe(first);
    expect(manager.list()).toHaveLength(1);

    expect(manager.udpSessionFor('gt06', '9.9.9.9', 5000)).toBeNull();
  });

  it('detects a cross-instance superseded session via the Redis snapshot', async () => {
    const store = new FakeRedisStore();
    const emitter = new RecordingEmitter();
    const manager = makeManager(store, emitter);
    const mine = openAndAuthenticate('dev-x', { now: NOW });
    manager.track(mine);
    await manager.registerAuthenticated(mine); // writes our snapshot

    // Another pod's session overwrites the global entry (reconnect landed there).
    await store.upsert('tenant-1', 'dev-x', { instanceID: 'pod-b', sessionID: 'session-b' });

    const result = await manager.sweep(LATER);
    expect(result.closedSuperseded).toBe(1);
    expect(mine.closeReason).toBe('DUPLICATE_SESSION');
    expect(
      emitter.events.some((e) => e.sessionId === (mine.id as string) && e.state === 'DISCONNECTED'),
    ).toBe(true);
  });

  it('does NOT close a session whose Redis snapshot still names it', async () => {
    const store = new FakeRedisStore();
    const emitter = new RecordingEmitter();
    const manager = makeManager(store, emitter);
    const mine = openAndAuthenticate('dev-y');
    manager.track(mine);
    await manager.registerAuthenticated(mine);

    const result = await manager.sweep(LATER);
    expect(result.closedSuperseded).toBe(0);
    expect(mine.isLive).toBe(true);
  });

  it('sweep tolerates a Redis outage (no throw, session stays live)', async () => {
    const store = new FakeRedisStore();
    store.failReads = true;
    const emitter = new RecordingEmitter();
    const manager = makeManager(store, emitter);
    const mine = openAndAuthenticate('dev-z');
    manager.track(mine);
    await manager.registerAuthenticated(mine);

    await expect(manager.sweep(LATER)).resolves.toBeDefined();
    expect(mine.isLive).toBe(true);
  });
});

describe('Sprint D §7 — conditional global-entry removal', () => {
  it('a closing session does not delete a NEWER session’s Redis entry', async () => {
    const store = new FakeRedisStore();
    const emitter = new RecordingEmitter();
    const manager = makeManager(store, emitter);

    const first = openAndAuthenticate('dev-r');
    manager.track(first);
    await manager.registerAuthenticated(first);

    // A different instance registers for the same device (reconnect to pod-b).
    await store.upsert('tenant-1', 'dev-r', { instanceID: 'pod-b', sessionID: 'session-b' });

    // pod-a's old socket closes — it must NOT remove pod-b's entry.
    await manager.close(first, 'REMOTE_DISCONNECT');
    expect(store.removedKeys).toHaveLength(0);
    expect(await store.get('tenant-1', 'dev-r')).toEqual({
      instanceID: 'pod-b',
      sessionID: 'session-b',
    });
  });

  it('a normal close removes its own entry', async () => {
    const store = new FakeRedisStore();
    const emitter = new RecordingEmitter();
    const manager = makeManager(store, emitter);
    const s = openAndAuthenticate('dev-r2');
    manager.track(s);
    await manager.registerAuthenticated(s);

    await manager.close(s, 'IDLE_TIMEOUT');
    expect(store.removedKeys).toHaveLength(1);
    expect(await store.get('tenant-1', 'dev-r2')).toBeNull();
  });
});

describe('Sprint D §36 — closeAll (graceful shutdown)', () => {
  it('closes every tracked session with SHUTDOWN', async () => {
    const emitter = new RecordingEmitter();
    const manager = makeManager(null, emitter);
    const a = openAndAuthenticate('dev-s1');
    const b = openAndAuthenticate('dev-s2');
    manager.track(a);
    manager.track(b);

    await manager.closeAll('SHUTDOWN');
    expect(manager.list()).toHaveLength(0);
    expect(a.closeReason).toBe('SHUTDOWN');
    expect(b.closeReason).toBe('SHUTDOWN');
  });
});

import { beforeEach, describe, expect, it } from '@jest/globals';
import { type SessionLifecycleEmitter, SessionManager } from '../application/session-manager.js';
import { DeviceSession } from '../domain/index.js';

const NOW = new Date('2026-08-05T10:00:00Z');

/** Records emitted lifecycle events. */
class RecordingEmitter implements SessionLifecycleEmitter {
  public readonly events: { state: string; deviceId: string | null; reason: string | null }[] = [];
  async publishSessionLifecycle(e: {
    state: string;
    deviceId: string | null;
    reason: string | null;
  }): Promise<void> {
    this.events.push({ state: e.state, deviceId: e.deviceId, reason: e.reason });
  }
}

function newSession(deviceId = 'dev-1'): DeviceSession {
  const s = DeviceSession.open({
    transport: 'tcp',
    protocolId: 'gt06',
    remoteAddress: '1.2.3.4',
    remotePort: 5000,
    instanceId: 'pod-a',
    now: NOW,
  });
  s.identify();
  s.authenticate({ deviceId, tenantId: 'tenant-1', serialOrImei: 'imei-1', now: NOW });
  return s;
}

describe('SessionManager — local index + lifecycle (06 §6)', () => {
  let emitter: RecordingEmitter;
  let manager: SessionManager;

  beforeEach(() => {
    emitter = new RecordingEmitter();
    manager = new SessionManager(null, emitter, 'pod-a', {
      tcpTtlSeconds: 60,
      udpTtlSeconds: 120,
    });
  });

  it('tracks a session and indexes it by session id', () => {
    const s = newSession();
    manager.track(s);
    expect(manager.bySessionId(s.id as string)).toBe(s);
    expect(manager.list()).toHaveLength(1);
  });

  it('registerAuthenticated indexes by device id + emits AUTHENTICATED', async () => {
    const s = newSession('dev-9');
    manager.track(s);
    await manager.registerAuthenticated(s);
    expect(manager.byDeviceId('dev-9')).toBe(s);
    expect(emitter.events.some((e) => e.state === 'AUTHENTICATED' && e.deviceId === 'dev-9')).toBe(
      true,
    );
  });

  it('markActive emits the ACTIVE transition', async () => {
    const s = newSession();
    manager.track(s);
    await manager.registerAuthenticated(s);
    s.activate(NOW);
    await manager.markActive(s);
    expect(emitter.events.some((e) => e.state === 'ACTIVE')).toBe(true);
  });

  it('close removes the session from both indexes + emits DISCONNECTED', async () => {
    const s = newSession('dev-c');
    manager.track(s);
    await manager.registerAuthenticated(s);
    await manager.close(s, 'IDLE_TIMEOUT');
    expect(manager.byDeviceId('dev-c')).toBeNull();
    expect(manager.bySessionId(s.id as string)).toBeNull();
    expect(
      emitter.events.some((e) => e.state === 'DISCONNECTED' && e.reason === 'IDLE_TIMEOUT'),
    ).toBe(true);
  });

  it('establishedAtFor returns the open time (06 §6.3 last-write-wins basis)', () => {
    const s = newSession();
    manager.track(s);
    expect(manager.establishedAtFor(s.id as string)).toBe(NOW.getTime());
  });

  // --- downstream command write path (06 §6.2) --------------------------------

  it('writerFor returns the registered writer only while the session is live', async () => {
    const s = newSession('dev-w');
    manager.track(s);
    const written: Buffer[] = [];
    manager.registerWriter(s.id as string, (data) => {
      written.push(data);
      return true;
    });
    const writer = manager.writerFor(s.id as string);
    expect(writer).not.toBeNull();
    expect(writer?.(Buffer.from('@@A'))).toBe(true);
    expect(written).toHaveLength(1);

    await manager.close(s, 'IDLE_TIMEOUT');
    // Closed sessions expose no writer (and the hook is cleared).
    expect(manager.writerFor(s.id as string)).toBeNull();
  });

  it('writerFor returns null for an unknown session id', () => {
    expect(manager.writerFor('nope')).toBeNull();
  });
});

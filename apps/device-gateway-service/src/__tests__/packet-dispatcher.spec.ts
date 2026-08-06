import { describe, expect, it } from '@jest/globals';
import { type AuthOutcome, AuthResolver } from '../application/auth-resolver.js';
import { PacketDispatcher, type PacketDispatcherDeps } from '../application/packet-dispatcher.js';
import { SessionManager } from '../application/session-manager.js';
import { DeviceMessage, DeviceSession, ProtocolError, RawPacket } from '../domain/index.js';
import type { ProtocolAdapter } from '../infrastructure/protocol/protocol-adapter.js';
import { InMemoryDeviceRegistry } from '../infrastructure/registry/index.js';
import { RawPacketStorage } from '../infrastructure/storage/raw-packet-storage.js';

const NOW = new Date('2026-08-05T10:00:00Z');

/** A fake adapter that yields pre-built messages, bypassing framing. */
function fakeAdapter(messages: DeviceMessage[]): ProtocolAdapter {
  return {
    id: 'stub',
    meta: {
      name: 'stub',
      defaultPort: 5099,
      transport: 'both',
      framingType: 'test',
      authStrategy: 'test',
      deviceModels: ['stub'],
    },
    detect: () => ({ confidence: 0 }),
    frame: () => {
      throw new Error('not used');
    },
    decode: () => messages,
    encode: () => Buffer.alloc(0),
  };
}

function rawPacket(): RawPacket {
  return new RawPacket({
    protocolId: 'stub',
    payload: Buffer.from([0xab, 0xcd]),
    receivedAt: NOW,
    direction: 'INBOUND',
  });
}

/** A fake Kafka that records published messages. */
class FakeKafka {
  public readonly published: DeviceMessage[] = [];
  async publish(m: DeviceMessage): Promise<void> {
    this.published.push(m);
  }
  async publishSessionLifecycle(): Promise<void> {
    /* no-op */
  }
}

/** A fake AuthResolver with a fixed outcome (used to simulate auth success/fail). */
class FixedAuthResolver {
  constructor(private readonly outcome: AuthOutcome) {}
  async resolve(): Promise<AuthOutcome> {
    return this.outcome;
  }
}

function buildDeps(overrides: Partial<PacketDispatcherDeps> & { authOutcome?: AuthOutcome } = {}): {
  deps: PacketDispatcherDeps;
  kafka: FakeKafka;
} {
  const kafka = new FakeKafka();
  const registry = new InMemoryDeviceRegistry().registerByImei('imei-1', {
    deviceId: 'dev-1',
    tenantId: 'tenant-1',
    status: 'ACTIVE',
    pairedVehicleId: null,
  });
  const authResolver =
    overrides.authOutcome !== undefined
      ? (new FixedAuthResolver(overrides.authOutcome) as unknown as AuthResolver)
      : new AuthResolver(null, registry);
  const sessionManager = new SessionManager(null, null, 'pod-a', {
    tcpTtlSeconds: 60,
    udpTtlSeconds: 120,
  });
  const deps: PacketDispatcherDeps = {
    authResolver,
    sessionManager,
    kafka: kafka as unknown as PacketDispatcherDeps['kafka'],
    rawStorage: new RawPacketStorage(),
  };
  return { deps, kafka };
}

function newSession(): DeviceSession {
  return DeviceSession.open({
    transport: 'tcp',
    protocolId: 'stub',
    remoteAddress: '1.2.3.4',
    remotePort: 5000,
    instanceId: 'pod-a',
    now: NOW,
  });
}

describe('PacketDispatcher — fail-closed pipeline (06 §8, §6.1)', () => {
  it('LOGIN authenticates the session and publishes the device.raw event', async () => {
    const { deps, kafka } = buildDeps();
    const dispatcher = new PacketDispatcher(deps);
    const session = newSession();
    const login = new DeviceMessage({
      messageId: 'm1',
      deviceId: '',
      serialOrImei: 'imei-1',
      tenantId: '',
      protocolId: 'stub',
      type: 'LOGIN',
      timestamp: NOW,
      ingestedAt: NOW,
      rawSize: 2,
      checksum: 'abc',
      direction: 'INBOUND',
    });
    const result = await dispatcher.dispatch(session, fakeAdapter([login]), rawPacket());
    expect(result.authenticated).toBe(true);
    expect(result.close).toBe(false);
    expect(session.state).toBe('AUTHENTICATED');
    expect(session.deviceId).toBe('dev-1');
    expect(kafka.published).toHaveLength(1);
    expect(kafka.published[0]?.deviceId).toBe('dev-1');
    expect(kafka.published[0]?.tenantId).toBe('tenant-1');
  });

  it('INVARIANT #1: never publishes a non-LOGIN message before AUTHENTICATED', async () => {
    const { deps, kafka } = buildDeps();
    const dispatcher = new PacketDispatcher(deps);
    const session = newSession(); // NEW
    const position = new DeviceMessage({
      messageId: 'm2',
      deviceId: '',
      serialOrImei: '',
      tenantId: '',
      protocolId: 'stub',
      type: 'POSITION',
      timestamp: NOW,
      ingestedAt: NOW,
      rawSize: 2,
      checksum: 'abc',
      direction: 'INBOUND',
    });
    const result = await dispatcher.dispatch(session, fakeAdapter([position]), rawPacket());
    expect(result.published).toBe(0); // dropped — not authenticated
    expect(kafka.published).toHaveLength(0);
    expect(session.state).toBe('NEW'); // unchanged
  });

  it('implicit login: a pre-auth non-LOGIN message carrying an IMEI authenticates + publishes (Meitrack model, 06 §7)', async () => {
    const { deps, kafka } = buildDeps();
    const dispatcher = new PacketDispatcher(deps);
    const session = newSession(); // NEW — no LOGIN sent
    const position = new DeviceMessage({
      messageId: 'm2b',
      deviceId: '',
      serialOrImei: 'imei-1', // identity embedded in the payload (Meitrack-style)
      tenantId: '',
      protocolId: 'meitrack',
      type: 'POSITION',
      timestamp: NOW,
      ingestedAt: NOW,
      rawSize: 2,
      checksum: 'abc',
      direction: 'INBOUND',
    });
    const result = await dispatcher.dispatch(session, fakeAdapter([position]), rawPacket());
    expect(result.authenticated).toBe(true);
    expect(result.close).toBe(false);
    expect(session.state).toBe('ACTIVE'); // POSITION after auth → ACTIVE
    expect(session.deviceId).toBe('dev-1');
    expect(session.tenantId).toBe('tenant-1');
    expect(kafka.published).toHaveLength(1); // the POSITION published, not dropped
    expect(kafka.published[0]?.deviceId).toBe('dev-1');
    expect(kafka.published[0]?.type).toBe('POSITION');
  });

  it('implicit login fails closed when the embedded IMEI is unknown', async () => {
    const { deps, kafka } = buildDeps();
    const dispatcher = new PacketDispatcher(deps);
    const session = newSession();
    const position = new DeviceMessage({
      messageId: 'm2c',
      deviceId: '',
      serialOrImei: 'no-such-imei',
      tenantId: '',
      protocolId: 'meitrack',
      type: 'POSITION',
      timestamp: NOW,
      ingestedAt: NOW,
      rawSize: 2,
      checksum: 'abc',
      direction: 'INBOUND',
    });
    const result = await dispatcher.dispatch(session, fakeAdapter([position]), rawPacket());
    expect(result.close).toBe(true);
    expect(result.closeReason).toBe('AUTH_FAILED');
    expect(kafka.published).toHaveLength(0);
  });

  it('auth failure on LOGIN closes the session (fail-closed, 06 §7.3)', async () => {
    const { deps, kafka } = buildDeps({
      authOutcome: { ok: false, reason: 'unknown' },
    });
    const dispatcher = new PacketDispatcher(deps);
    const session = newSession();
    const login = new DeviceMessage({
      messageId: 'm3',
      deviceId: '',
      serialOrImei: 'no-such',
      tenantId: '',
      protocolId: 'stub',
      type: 'LOGIN',
      timestamp: NOW,
      ingestedAt: NOW,
      rawSize: 2,
      checksum: 'abc',
      direction: 'INBOUND',
    });
    const result = await dispatcher.dispatch(session, fakeAdapter([login]), rawPacket());
    expect(result.close).toBe(true);
    expect(result.closeReason).toBe('AUTH_FAILED');
    expect(kafka.published).toHaveLength(0);
  });

  it('a POSITION after LOGIN transitions the session to ACTIVE and publishes', async () => {
    const { deps, kafka } = buildDeps();
    const dispatcher = new PacketDispatcher(deps);
    const session = newSession();
    session.identify();
    // First: LOGIN
    await dispatcher.dispatch(
      session,
      fakeAdapter([
        new DeviceMessage({
          messageId: 'm4',
          deviceId: '',
          serialOrImei: 'imei-1',
          tenantId: '',
          protocolId: 'stub',
          type: 'LOGIN',
          timestamp: NOW,
          ingestedAt: NOW,
          rawSize: 2,
          checksum: 'abc',
          direction: 'INBOUND',
        }),
      ]),
      rawPacket(),
    );
    expect(session.state).toBe('AUTHENTICATED');
    // Then: POSITION
    const result = await dispatcher.dispatch(
      session,
      fakeAdapter([
        new DeviceMessage({
          messageId: 'm5',
          deviceId: '',
          serialOrImei: 'imei-1',
          tenantId: '',
          protocolId: 'stub',
          type: 'POSITION',
          timestamp: NOW,
          ingestedAt: NOW,
          position: {
            latitude: 35.0,
            longitude: 139.0,
            speedKph: 0,
            headingDeg: 0,
            altitudeM: null,
            satellites: null,
            timestamp: NOW,
            ignitionOn: true,
          },
          rawSize: 2,
          checksum: 'def',
          direction: 'INBOUND',
        }),
      ]),
      rawPacket(),
    );
    expect(result.published).toBe(1);
    expect(session.state).toBe('ACTIVE');
    expect(session.firstDataAt).toEqual(NOW);
    expect(kafka.published).toHaveLength(2); // login + position
  });

  it('a ProtocolError in decode is swallowed (drop + metric, not a crash)', async () => {
    const { deps, kafka } = buildDeps();
    const dispatcher = new PacketDispatcher(deps);
    const session = newSession();
    const badAdapter: ProtocolAdapter = {
      id: 'stub',
      meta: fakeAdapter([]).meta,
      detect: () => ({ confidence: 0 }),
      frame: () => {
        throw new Error('not used');
      },
      decode: () => {
        throw new ProtocolError('bad', 'stub');
      },
      encode: () => Buffer.alloc(0),
    };
    const result = await dispatcher.dispatch(session, badAdapter, rawPacket());
    expect(result.published).toBe(0);
    expect(result.close).toBe(false);
    expect(kafka.published).toHaveLength(0);
  });
});

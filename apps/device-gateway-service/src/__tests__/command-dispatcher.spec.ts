import { describe, expect, it } from '@jest/globals';
import { CommandDispatcher } from '../application/command-dispatcher.js';
import type { SessionManager } from '../application/session-manager.js';
import type { DeviceSession } from '../domain/device-session.js';
import type { DeviceGatewayKafkaProducer } from '../infrastructure/kafka/kafka-producer.js';
import type { AdapterRegistry } from '../infrastructure/protocol/adapter-registry.js';
import type { ProtocolAdapter } from '../infrastructure/protocol/protocol-adapter.js';
import type { SessionRedisStore } from '../infrastructure/storage/session-redis-store.js';

const DEVICE_ID = 'device-1';
const IMEI = '866854036516451';

interface FakeSession {
  id: string;
  deviceId: string | null;
  protocolId: string;
  serialOrImei: string | null;
  /** Mirrors DeviceSession.canDispatchCommand() (06 §6.1 invariant #2). */
  canDispatchCommand(): boolean;
}

function makeSession(
  overrides: Partial<{
    id: string;
    deviceId: string | null;
    protocolId: string;
    serialOrImei: string | null;
    dispatchable: boolean;
  }> = {},
): FakeSession {
  const dispatchable = overrides.dispatchable ?? true;
  return {
    id: overrides.id ?? 'session-1',
    deviceId: overrides.deviceId ?? DEVICE_ID,
    protocolId: overrides.protocolId ?? 'meitrack',
    serialOrImei: overrides.serialOrImei ?? IMEI,
    canDispatchCommand: () => dispatchable,
  };
}

function makeDeps(overrides?: {
  session?: FakeSession | null;
  writer?: ((data: Buffer) => boolean) | null;
  redisSnapshot?: unknown;
}) {
  const written: Buffer[] = [];
  const events: Array<Record<string, unknown>> = [];

  const session = overrides?.session === undefined ? makeSession() : overrides.session;
  const sessions = {
    byDeviceId: (deviceId: string) =>
      session && session.deviceId === deviceId ? (session as never as DeviceSession) : null,
    writerFor: (sessionId: string) => {
      if (!session || session.id !== sessionId) return null;
      if (overrides?.writer === null) return null;
      const w =
        overrides?.writer ??
        ((data: Buffer) => {
          written.push(data);
          return true;
        });
      return w;
    },
  } as unknown as SessionManager;

  const adapter: ProtocolAdapter = {
    id: 'meitrack',
    encode: (cmd: { payload: Record<string, unknown> }) =>
      Buffer.from(`@@frame(${JSON.stringify(cmd.payload.text)})`, 'ascii'),
  } as unknown as ProtocolAdapter;

  const adapters = { get: () => adapter } as unknown as AdapterRegistry;

  const kafka = {
    publishCommandEvent: async (event: Record<string, unknown>) => {
      events.push(event);
    },
  } as unknown as DeviceGatewayKafkaProducer;

  const redisStore =
    overrides?.redisSnapshot !== undefined
      ? ({ get: async () => overrides?.redisSnapshot } as unknown as SessionRedisStore)
      : null;

  const dispatcher = new CommandDispatcher(sessions, adapters, kafka, redisStore);
  return { dispatcher, written, events };
}

const REQUEST = {
  commandId: 'cmd-1',
  deviceId: DEVICE_ID,
  tenantId: 'tenant-1',
  protocolId: 'meitrack',
  commandCode: 'A12',
  payloadText: 'A12,6',
  payloadHex: null,
};

describe('CommandDispatcher (downstream command path, 06 §6.2)', () => {
  it('encodes and writes the frame to the session writer, publishing SENT', async () => {
    const { dispatcher, written, events } = makeDeps();
    const result = await dispatcher.dispatch(REQUEST);
    expect(result).toEqual({ outcome: 'SENT' });
    expect(written).toHaveLength(1);
    expect(written[0]?.toString('ascii')).toContain('A12,6');
    expect(events[0]).toMatchObject({ commandId: 'cmd-1', result: 'SENT' });
  });

  it('passes the session IMEI (not the device UUID) to the encoder', async () => {
    let seenPayload: Record<string, unknown> = {};
    const session = makeSession();
    const sessions = {
      byDeviceId: () => session as never,
      writerFor: () => (data: Buffer) => {
        seenPayload = { data: data.toString() };
        return true;
      },
    } as unknown as SessionManager;
    let encoded: Record<string, unknown> = {};
    const adapter = {
      encode: (cmd: { payload: Record<string, unknown> }) => {
        encoded = cmd.payload;
        return Buffer.from('x');
      },
    } as unknown as ProtocolAdapter;
    const dispatcher = new CommandDispatcher(
      sessions,
      { get: () => adapter } as unknown as AdapterRegistry,
      null,
      null,
    );
    await dispatcher.dispatch(REQUEST);
    expect(encoded).toMatchObject({ imei: IMEI, text: 'A12,6' });
    void seenPayload;
  });

  it('encodes hex payloads for binary (media) commands', async () => {
    let encoded: Record<string, unknown> = {};
    const session = makeSession();
    const sessions = {
      byDeviceId: () => session as never,
      writerFor: () => () => true,
    } as unknown as SessionManager;
    const adapter = {
      encode: (cmd: { payload: Record<string, unknown> }) => {
        encoded = cmd.payload;
        return Buffer.from('x');
      },
    } as unknown as ProtocolAdapter;
    const dispatcher = new CommandDispatcher(
      sessions,
      { get: () => adapter } as unknown as AdapterRegistry,
      null,
      null,
    );
    await dispatcher.dispatch({ ...REQUEST, payloadText: null, payloadHex: '4139422C01010000' });
    expect(encoded).toMatchObject({ imei: IMEI, hex: '4139422C01010000' });
  });

  it('rejects with DEVICE_NOT_AUTHENTICATED when the session cannot dispatch', async () => {
    const { dispatcher, events } = makeDeps({ session: makeSession({ dispatchable: false }) });
    const result = await dispatcher.dispatch({
      ...REQUEST,
      commandCode: 'C01',
      payloadText: 'C01,20,10122',
    });
    expect(result).toEqual({ outcome: 'REJECTED', reason: 'DEVICE_NOT_AUTHENTICATED' });
    expect(events[0]).toMatchObject({ result: 'REJECTED', reason: 'DEVICE_NOT_AUTHENTICATED' });
  });

  it('rejects with DEVICE_OFFLINE when no local session and no global snapshot', async () => {
    const { dispatcher, events } = makeDeps({ session: null, redisSnapshot: null });
    const result = await dispatcher.dispatch({
      ...REQUEST,
      commandCode: 'C01',
      payloadText: 'C01,20,10122',
    });
    expect(result).toEqual({ outcome: 'REJECTED', reason: 'DEVICE_OFFLINE' });
    expect(events[0]).toMatchObject({ result: 'REJECTED', reason: 'DEVICE_OFFLINE' });
  });

  it('holds A10 while fully offline (no session) until flushHeld', async () => {
    const written: Buffer[] = [];
    let session: FakeSession | null = null;
    const sessions = {
      byDeviceId: (deviceId: string) =>
        session && session.deviceId === deviceId ? (session as never as DeviceSession) : null,
      writerFor: () => (data: Buffer) => {
        written.push(data);
        return true;
      },
    } as unknown as SessionManager;
    const adapter = {
      id: 'meitrack',
      encode: (cmd: { payload: Record<string, unknown> }) =>
        Buffer.from(String(cmd.payload.text ?? ''), 'ascii'),
    } as unknown as ProtocolAdapter;
    const dispatcher = new CommandDispatcher(
      sessions,
      { get: () => adapter } as unknown as AdapterRegistry,
      null,
      null,
    );
    const a10 = { ...REQUEST, commandCode: 'A10', payloadText: 'A10' };
    expect(await dispatcher.dispatch(a10)).toEqual({ outcome: 'HELD' });
    expect(written).toHaveLength(0);
    session = makeSession();
    await dispatcher.flushHeld(DEVICE_ID);
    expect(written).toHaveLength(1);
    expect(written[0]?.toString('ascii')).toContain('A10');
  });

  it('holds AB2 while offline and writes it after flushHeld', async () => {
    const written: Buffer[] = [];
    const events: Array<Record<string, unknown>> = [];
    let session: FakeSession | null = null;
    const sessions = {
      byDeviceId: (deviceId: string) =>
        session && session.deviceId === deviceId ? (session as never as DeviceSession) : null,
      writerFor: () => (data: Buffer) => {
        written.push(data);
        return true;
      },
    } as unknown as SessionManager;
    const adapter = {
      id: 'meitrack',
      encode: (cmd: { payload: Record<string, unknown> }) =>
        Buffer.from(`@@${String(cmd.payload.hex)}`, 'ascii'),
    } as unknown as ProtocolAdapter;
    const kafka = {
      publishCommandEvent: async (event: Record<string, unknown>) => {
        events.push(event);
      },
    } as unknown as DeviceGatewayKafkaProducer;
    const dispatcher = new CommandDispatcher(
      sessions,
      { get: () => adapter } as unknown as AdapterRegistry,
      kafka,
      null,
    );
    const ab2 = { ...REQUEST, commandCode: 'AB2', payloadText: null, payloadHex: '4142322C' };
    expect(await dispatcher.dispatch(ab2)).toEqual({ outcome: 'HELD' });
    expect(written).toHaveLength(0);
    expect(events).toHaveLength(0);

    session = makeSession();
    await dispatcher.flushHeld(DEVICE_ID);
    expect(written).toHaveLength(1);
    expect(events[0]).toMatchObject({ result: 'SENT', commandCode: 'AB2' });
  });

  it('holds two AB2 payloads (two cameras) and flushes both', async () => {
    const written: Buffer[] = [];
    let session: FakeSession | null = null;
    const sessions = {
      byDeviceId: (deviceId: string) =>
        session && session.deviceId === deviceId ? (session as never as DeviceSession) : null,
      writerFor: () => (data: Buffer) => {
        written.push(data);
        return true;
      },
    } as unknown as SessionManager;
    const adapter = {
      id: 'meitrack',
      encode: (cmd: { payload: Record<string, unknown> }) =>
        Buffer.from(String(cmd.payload.hex), 'ascii'),
    } as unknown as ProtocolAdapter;
    const dispatcher = new CommandDispatcher(
      sessions,
      { get: () => adapter } as unknown as AdapterRegistry,
      null,
      null,
    );
    const ch1 = { ...REQUEST, commandCode: 'AB2', payloadText: null, payloadHex: '4142322C31' };
    const ch2 = {
      ...REQUEST,
      commandId: 'cmd-2',
      commandCode: 'AB2',
      payloadText: null,
      payloadHex: '4142322C32',
    };
    expect(await dispatcher.dispatch(ch1)).toEqual({ outcome: 'HELD' });
    expect(await dispatcher.dispatch(ch2)).toEqual({ outcome: 'HELD' });
    session = makeSession();
    await dispatcher.flushHeld(DEVICE_ID);
    expect(written).toHaveLength(2);
  });

  it('stays silent (ROUTED_ELSEWHERE) when another instance owns the session', async () => {
    const { dispatcher, events } = makeDeps({
      session: null,
      redisSnapshot: { sessionID: 'other' },
    });
    const result = await dispatcher.dispatch(REQUEST);
    expect(result).toEqual({ outcome: 'ROUTED_ELSEWHERE' });
    expect(events).toHaveLength(0);
  });

  it('rejects when the socket write fails', async () => {
    const { dispatcher, events } = makeDeps({ writer: () => false });
    const result = await dispatcher.dispatch(REQUEST);
    expect(result).toEqual({ outcome: 'REJECTED', reason: 'SOCKET_WRITE_FAILED' });
    expect(events[0]).toMatchObject({ result: 'REJECTED' });
  });

  it('rejects when no writer is registered', async () => {
    const { dispatcher } = makeDeps({ writer: null });
    const result = await dispatcher.dispatch(REQUEST);
    expect(result).toEqual({ outcome: 'REJECTED', reason: 'NO_TRANSPORT_WRITER' });
  });

  it('rejects when the adapter cannot be found', async () => {
    const session = makeSession({ protocolId: 'nope' });
    const sessions = {
      byDeviceId: () => session as never,
      writerFor: () => () => true,
    } as unknown as SessionManager;
    const dispatcher = new CommandDispatcher(
      sessions,
      { get: () => null } as unknown as AdapterRegistry,
      null,
      null,
    );
    const result = await dispatcher.dispatch(REQUEST);
    expect(result).toEqual({ outcome: 'REJECTED', reason: 'ADAPTER_NOT_FOUND:nope' });
  });
});

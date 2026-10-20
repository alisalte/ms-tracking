import { type AddressInfo, createConnection } from 'node:net';
import { describe, expect, it } from '@jest/globals';
import { DeviceSession, RawPacket } from '../domain/index.js';
import type { ProtocolAdapter } from '../infrastructure/protocol/protocol-adapter.js';
import { NEED_MORE } from '../infrastructure/transport/byte-reader.js';
import { TcpListener } from '../infrastructure/transport/tcp-server.js';

/** One-byte frames: every byte received is a complete packet. */
const byteAdapter: ProtocolAdapter = {
  id: 'stub',
  meta: {
    name: 'stub',
    defaultPort: 0,
    transport: 'tcp',
    framingType: 'test',
    authStrategy: 'test',
    deviceModels: ['stub'],
  },
  detect: () => ({ confidence: 0 }),
  frame: (reader, receivedAt) => {
    const b = reader.read(1);
    if (b === NEED_MORE) return NEED_MORE;
    return new RawPacket({
      protocolId: 'stub',
      payload: b,
      receivedAt,
      direction: 'INBOUND',
    });
  },
  decode: () => [],
  encode: () => Buffer.alloc(0),
};

describe('TcpListener — frame draining', () => {
  it('dispatches every frame of a burst larger than one drain slice, in order', async () => {
    const FRAMES = 200;
    const seen: number[] = [];
    const done = new Promise<void>((resolve) => {
      const listener = new TcpListener({
        adapter: byteAdapter,
        port: 0,
        host: '127.0.0.1',
        idleTimeoutMs: 5_000,
        openSession: (init) => DeviceSession.open({ ...init, instanceId: 'pod-a' }),
        // Slow handler: yields to the loop so a second 'data' event can interleave.
        onPacket: async (_ctx, packet) => {
          await new Promise((r) => setImmediate(r));
          seen.push(packet[0] as number);
          if (seen.length === FRAMES) resolve();
          return true;
        },
      });
      void listener.listen().then(() => {
        // biome-ignore lint/suspicious/noExplicitAny: reach the bound ephemeral port
        const port = ((listener as any).server.address() as AddressInfo).port;
        const sock = createConnection({ port, host: '127.0.0.1' }, () => {
          const all = Buffer.from(Array.from({ length: FRAMES }, (_, i) => i % 256));
          sock.write(all.subarray(0, 100));
          sock.write(all.subarray(100));
          sock.end();
        });
        done.finally(() => void listener.close());
      });
    });
    await done;
    expect(seen).toEqual(Array.from({ length: FRAMES }, (_, i) => i % 256));
  });
});

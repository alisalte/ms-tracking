import { type AddressInfo, type Socket, createConnection } from 'node:net';
import { describe, expect, it } from '@jest/globals';
import { DeviceSession } from '../domain/index.js';
import { MeitrackAdapter } from '../infrastructure/adapters/meitrack/meitrack.adapter.js';
import { meitrackChecksum } from '../infrastructure/adapters/meitrack/meitrack.frames.js';
import { TeltonikaAdapter } from '../infrastructure/adapters/teltonika/teltonika.adapter.js';
import { TcpListener } from '../infrastructure/transport/tcp-server.js';

const IMEI = '356307042441013';
const meitrack = new MeitrackAdapter();
const teltonika = new TeltonikaAdapter();

function meitrackFrame(content: string): Buffer {
  const block = `,${content}`;
  const head = `$$A${String(block.length + 1 + 2 + 2).padStart(4, '0')}`;
  const region = `${head}${block}*`;
  return Buffer.from(`${region}${meitrackChecksum(Buffer.from(region, 'ascii'))}\r\n`, 'ascii');
}
const teltonikaImei = Buffer.concat([Buffer.from([0x00, 0x0f]), Buffer.from(IMEI, 'ascii')]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(5);
  }
}

async function start() {
  const seen: Array<{ adapter: string; session: string; payload: Buffer }> = [];
  const opened: string[] = [];
  const listener = new TcpListener({
    candidates: [meitrack, teltonika],
    port: 0,
    host: '127.0.0.1',
    idleTimeoutMs: 5_000,
    openSession: (init) => {
      opened.push(init.protocolId);
      return DeviceSession.open({ ...init, instanceId: 'pod-a' });
    },
    onPacket: async (ctx, payload) => {
      seen.push({ adapter: ctx.adapter.id, session: ctx.session.protocolId, payload });
      return true;
    },
  });
  await listener.listen();
  // biome-ignore lint/suspicious/noExplicitAny: reach the bound ephemeral port
  const port = ((listener as any).server.address() as AddressInfo).port;
  const connect = async (): Promise<Socket> => {
    const s = createConnection({ port, host: '127.0.0.1' });
    await new Promise<void>((r) => s.once('connect', () => r()));
    return s;
  };
  return { listener, seen, opened, connect };
}

describe('TcpListener — shared port (protocol detection)', () => {
  it('routes a Meitrack and a Teltonika device on one port to their own parsers', async () => {
    const { listener, seen, connect } = await start();
    const m = await connect();
    const t = await connect();

    const mFrame = meitrackFrame(`${IMEI},AAA,35,22.9,113.3,260805100000,A,8,31,0,0,1.2,55,1200`);
    m.write(mFrame);
    // Teltonika's IMEI arrives split across TCP segments — detection must wait for it.
    t.write(teltonikaImei.subarray(0, 5));
    await sleep(20);
    t.write(teltonikaImei.subarray(5));

    await until(() => seen.length === 2);
    const byAdapter = Object.fromEntries(seen.map((x) => [x.adapter, x]));
    expect(byAdapter.meitrack?.payload.equals(mFrame)).toBe(true);
    expect(byAdapter.meitrack?.session).toBe('meitrack');
    expect(byAdapter.teltonika?.payload.equals(teltonikaImei)).toBe(true);
    expect(byAdapter.teltonika?.session).toBe('teltonika');

    m.destroy();
    t.destroy();
    await listener.close();
  });

  it('closes an unrecognised client without ever opening a session', async () => {
    const { listener, seen, opened, connect } = await start();
    const s = await connect();
    const closed = new Promise<void>((r) => s.once('close', () => r()));
    s.write(Buffer.from('GET / HTTP/1.1\r\nHost: x\r\n\r\n'.repeat(4)));
    await closed;
    expect(seen).toHaveLength(0);
    expect(opened).toHaveLength(0);
    await listener.close();
  });

  it('needs exactly one of adapter / candidates', () => {
    const base = {
      port: 0,
      idleTimeoutMs: 1000,
      openSession: () => null,
      onPacket: async () => true,
    };
    expect(() => new TcpListener({ ...base })).toThrow();
    expect(
      () => new TcpListener({ ...base, adapter: meitrack, candidates: [teltonika] }),
    ).toThrow();
  });
});

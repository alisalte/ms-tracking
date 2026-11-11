import { type AddressInfo, createConnection } from 'node:net';
import { describe, expect, it } from '@jest/globals';
import type { AuthOutcome } from '../application/auth-resolver.js';
import type { AuthResolver } from '../application/auth-resolver.js';
import { PacketDispatcher, type PacketDispatcherDeps } from '../application/packet-dispatcher.js';
import { SessionManager } from '../application/session-manager.js';
import { DeviceSession, ProtocolError, type RawPacket } from '../domain/index.js';
import { TeltonikaAdapter } from '../infrastructure/adapters/teltonika/teltonika.adapter.js';
import { encodeCodec12Command } from '../infrastructure/adapters/teltonika/teltonika.encode.js';
import { teltonikaCrc16 } from '../infrastructure/adapters/teltonika/teltonika.frames.js';
import { RawPacketStorage } from '../infrastructure/storage/raw-packet-storage.js';
import { ByteReader, NEED_MORE } from '../infrastructure/transport/byte-reader.js';
import { TcpListener } from '../infrastructure/transport/tcp-server.js';

const NOW = new Date('2026-11-10T08:00:00Z');
const IMEI = '356307042441013';
const adapter = new TeltonikaAdapter();

/** Official Teltonika wiki Codec 8 example (1 record, no GNSS fix, event IO 1). */
const WIKI_CODEC8 = Buffer.from(
  '000000000000003608010000016B40D8EA30010000000000000000000000000000000105021503010101425E0F01F10000601A014E0000000000000000010000C7CF',
  'hex',
);

// ── packet builders ──────────────────────────────────────────────────────────

const u8 = (n: number) => Buffer.from([n & 0xff]);
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff);
  return b;
};
const i16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const i32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};

type IoSpec = { id: number; width: 1 | 2 | 4 | 8; value: number | bigint };

interface RecordSpec {
  timestamp?: number;
  lat?: number; // degrees
  lon?: number;
  alt?: number;
  angle?: number;
  sats?: number;
  speed?: number;
  eventIo?: number;
  io?: IoSpec[];
  variable?: Array<{ id: number; bytes: Buffer }>; // codec 8E only
}

const TS = Date.UTC(2026, 10, 10, 7, 59, 30);

function record(codec: 0x08 | 0x8e | 0x10, r: RecordSpec): Buffer {
  const idW = codec === 0x08 ? u8 : u16;
  const cntW = codec === 0x10 || codec === 0x08 ? u8 : u16;
  const io = r.io ?? [];
  const groups = ([1, 2, 4, 8] as const).map((w) => io.filter((e) => e.width === w));
  const parts: Buffer[] = [
    u64(r.timestamp ?? TS),
    u8(1),
    i32(Math.round((r.lon ?? 0) * 1e7)),
    i32(Math.round((r.lat ?? 0) * 1e7)),
    i16(r.alt ?? 0),
    u16(r.angle ?? 0),
    u8(r.sats ?? 0),
    u16(r.speed ?? 0),
    idW(r.eventIo ?? 0),
  ];
  if (codec === 0x10) parts.push(u8(0)); // generation type
  parts.push(cntW(io.length + (r.variable?.length ?? 0)));
  for (const [i, g] of groups.entries()) {
    const w = ([1, 2, 4, 8] as const)[i] as 1 | 2 | 4 | 8;
    parts.push(cntW(g.length));
    for (const e of g) {
      parts.push(idW(e.id));
      const v = BigInt(e.value);
      const b = Buffer.alloc(w);
      if (w === 8) b.writeBigUInt64BE(v);
      else b.writeUIntBE(Number(BigInt.asUintN(w * 8, v)), 0, w);
      parts.push(b);
    }
  }
  if (codec === 0x8e) {
    parts.push(u16(r.variable?.length ?? 0));
    for (const v of r.variable ?? []) parts.push(u16(v.id), u16(v.bytes.length), v.bytes);
  }
  return Buffer.concat(parts);
}

function avl(codec: 0x08 | 0x8e | 0x10, records: RecordSpec[]): Buffer {
  const data = Buffer.concat([
    u8(codec),
    u8(records.length),
    ...records.map((r) => record(codec, r)),
    u8(records.length),
  ]);
  return Buffer.concat([u32(0), u32(data.length), data, u32(teltonikaCrc16(data))]);
}

const imeiFrame = (imei = IMEI) => Buffer.concat([u16(imei.length), Buffer.from(imei, 'ascii')]);

function frameOne(bytes: Buffer): RawPacket {
  const reader = new ByteReader();
  reader.append(bytes);
  const out = adapter.frame(reader, NOW);
  if (out === NEED_MORE) throw new Error('NEED_MORE');
  return out;
}

const decode = (bytes: Buffer) => adapter.decode(frameOne(bytes));

// ── tests ────────────────────────────────────────────────────────────────────

describe('teltonikaCrc16', () => {
  it('matches the CRC of the official Codec 8 example', () => {
    const data = WIKI_CODEC8.subarray(8, 8 + 54);
    expect(teltonikaCrc16(data)).toBe(0xc7cf);
  });

  it('matches the official Codec 12 "getinfo" command', () => {
    expect(encodeCodec12Command('getinfo').toString('hex')).toBe(
      '000000000000000f0c010500000007676574696e666f0100004312',
    );
  });
});

describe('TeltonikaAdapter.detect', () => {
  it('recognizes the IMEI login frame', () => {
    expect(adapter.detect(imeiFrame()).confidence).toBeGreaterThan(0.9);
  });
  it('recognizes an AVL packet', () => {
    expect(adapter.detect(WIKI_CODEC8).confidence).toBeGreaterThan(0.5);
  });
  it('rejects GT06, Meitrack and noise', () => {
    expect(adapter.detect(Buffer.from([0x78, 0x78, 0x0a, 0x01])).confidence).toBe(0);
    expect(adapter.detect(Buffer.from('$$A25,123*00\r\n')).confidence).toBe(0);
    expect(adapter.detect(Buffer.alloc(0)).confidence).toBe(0);
  });
});

describe('TeltonikaAdapter.frame', () => {
  it('frames the IMEI login and decodes it as LOGIN', () => {
    const [msg] = decode(imeiFrame());
    expect(msg?.type).toBe('LOGIN');
    expect(msg?.serialOrImei).toBe(IMEI);
    expect(msg?.protocolId).toBe('teltonika');
  });

  it('waits for a split AVL packet, then frames it', () => {
    const reader = new ByteReader();
    reader.append(WIKI_CODEC8.subarray(0, 20));
    expect(adapter.frame(reader, NOW)).toBe(NEED_MORE);
    reader.append(WIKI_CODEC8.subarray(20));
    const raw = adapter.frame(reader, NOW);
    expect(raw).not.toBe(NEED_MORE);
    expect((raw as RawPacket).payload.equals(WIKI_CODEC8)).toBe(true);
  });

  it('frames back-to-back packets one at a time', () => {
    const reader = new ByteReader();
    reader.append(Buffer.concat([imeiFrame(), WIKI_CODEC8]));
    const a = adapter.frame(reader, NOW) as RawPacket;
    const b = adapter.frame(reader, NOW) as RawPacket;
    expect(a.payload.length).toBe(17);
    expect(b.payload.length).toBe(WIKI_CODEC8.length);
    expect(adapter.frame(reader, NOW)).toBe(NEED_MORE);
  });

  it('discards TCP ping bytes (0xFF)', () => {
    const reader = new ByteReader();
    reader.append(Buffer.concat([Buffer.from([0xff, 0xff]), imeiFrame()]));
    expect((adapter.frame(reader, NOW) as RawPacket).payload.length).toBe(17);
  });

  it('consumes a CRC-failed packet and reports it, so the stream stays in sync', () => {
    const bad = Buffer.from(WIKI_CODEC8);
    bad.writeUInt8((bad.readUInt8(bad.length - 1) ^ 0xff) & 0xff, bad.length - 1);
    const reader = new ByteReader();
    reader.append(Buffer.concat([bad, imeiFrame()]));
    expect(() => adapter.frame(reader, NOW)).toThrow(ProtocolError);
    expect((adapter.frame(reader, NOW) as RawPacket).payload.length).toBe(17);
  });

  it('rejects something that is not Teltonika framing', () => {
    const reader = new ByteReader();
    reader.append(Buffer.from('GET / HTTP/1.1\r\n\r\n'));
    expect(() => adapter.frame(reader, NOW)).toThrow(ProtocolError);
    expect(reader.isEmpty).toBe(true);
  });
});

describe('Teltonika decode — codec 8', () => {
  it('decodes the official example: no fix → TELEMETRY, device clock preserved', () => {
    const msgs = decode(WIKI_CODEC8);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.type).toBe('TELEMETRY');
    expect(msgs[0]?.position).toBeUndefined();
    expect(msgs[0]?.timestamp.toISOString()).toBe('2019-06-10T10:04:46.000Z');
  });

  it('a valid fix becomes a POSITION with mapped telemetry', () => {
    const [msg] = decode(
      avl(0x08, [
        {
          lat: 54.6872,
          lon: 25.2797,
          alt: 112,
          angle: 90,
          sats: 9,
          speed: 55,
          io: [
            { id: 239, width: 1, value: 1 }, // ignition
            { id: 66, width: 2, value: 12500 }, // external voltage mV
            { id: 16, width: 4, value: 123456 }, // odometer m
            { id: 72, width: 4, value: 0xffffffce }, // temp1 = -50 × 0.1 °C
            { id: 182, width: 2, value: 12 }, // hdop ×0.1
            { id: 250, width: 1, value: 7 }, // not catalogued → io only
          ],
        },
      ]),
    );
    expect(msg?.type).toBe('POSITION');
    expect(msg?.position).toMatchObject({
      latitude: 54.6872,
      longitude: 25.2797,
      altitudeM: 112,
      headingDeg: 90,
      satellites: 9,
      speedKph: 55,
      ignitionOn: true,
    });
    expect(msg?.timestamp.getTime()).toBe(TS);
    expect(msg?.telemetry).toMatchObject({
      ignitionOn: true,
      fixValid: true,
      powerVoltage: 12.5,
      odometerKm: 123.456,
      temperature1: -5,
      hdop: 1.2,
    });
    expect(msg?.io).toMatchObject({ '239': 1, '66': 12500, '250': 7 });
  });

  it('keeps the sign of southern / western coordinates', () => {
    const [msg] = decode(avl(0x08, [{ lat: -33.8688, lon: -70.6693, sats: 7 }]));
    expect(msg?.position?.latitude).toBeCloseTo(-33.8688, 6);
    expect(msg?.position?.longitude).toBeCloseTo(-70.6693, 6);
  });

  it('treats satellites = 0 or 0,0 as no fix (never plots the last-known point)', () => {
    expect(decode(avl(0x08, [{ lat: 54.6, lon: 25.2, sats: 0 }]))[0]?.type).toBe('TELEMETRY');
    expect(decode(avl(0x08, [{ lat: 0, lon: 0, sats: 6 }]))[0]?.type).toBe('TELEMETRY');
  });

  it('decodes every record of a batch in order', () => {
    const msgs = decode(
      avl(0x08, [
        { timestamp: TS, lat: 1, lon: 1, sats: 5 },
        { timestamp: TS + 1000, lat: 2, lon: 2, sats: 5 },
        { timestamp: TS + 2000, lat: 3, lon: 3, sats: 5 },
      ]),
    );
    expect(msgs.map((m) => m.position?.latitude)).toEqual([1, 2, 3]);
  });

  it('falls back to receive time for an unset device clock', () => {
    const [msg] = decode(avl(0x08, [{ timestamp: 0, lat: 1, lon: 1, sats: 5 }]));
    expect(msg?.timestamp).toEqual(NOW);
  });

  it('serializes 8-byte IO values safely (no BigInt in the Kafka payload)', () => {
    const [msg] = decode(
      avl(0x08, [
        { lat: 1, lon: 1, sats: 5, io: [{ id: 78, width: 8, value: 0x1234567890abcdefn }] },
      ]),
    );
    expect(typeof msg?.io?.['78']).toBe('string');
    expect(() => JSON.stringify(msg?.io)).not.toThrow();
  });
});

describe('Teltonika decode — codec 8 Extended and 16', () => {
  it('decodes codec 8E with 2-byte ids and variable-length IO', () => {
    const [msg] = decode(
      avl(0x8e, [
        {
          lat: 54.6872,
          lon: 25.2797,
          sats: 8,
          speed: 10,
          io: [
            { id: 239, width: 1, value: 0 },
            { id: 67, width: 2, value: 4100 },
          ],
          variable: [{ id: 11317, bytes: Buffer.from('abcd', 'hex') }],
        },
      ]),
    );
    expect(msg?.type).toBe('POSITION');
    expect(msg?.telemetry).toMatchObject({ ignitionOn: false, batteryVoltage: 4.1 });
    expect(msg?.io?.['11317']).toBe('abcd');
  });

  it('decodes codec 16 (generation-type byte)', () => {
    const [msg] = decode(
      avl(0x10, [{ lat: 54.6872, lon: 25.2797, sats: 8, io: [{ id: 239, width: 1, value: 1 }] }]),
    );
    expect(msg?.type).toBe('POSITION');
    expect(msg?.position?.ignitionOn).toBe(true);
  });
});

describe('Teltonika decode — alarms', () => {
  const fix = { lat: 54.6872, lon: 25.2797, sats: 9, speed: 40 };

  it('unplugged power (252) → POWER_CUT alarm plus the position', () => {
    const msgs = decode(
      avl(0x08, [{ ...fix, eventIo: 252, io: [{ id: 252, width: 1, value: 1 }] }]),
    );
    expect(msgs.map((m) => m.type)).toEqual(['ALARM', 'POSITION']);
    expect(msgs[0]?.alarms?.[0]).toMatchObject({ code: 'POWER_CUT', severity: 'CRITICAL' });
    expect(msgs[0]?.position?.latitude).toBe(54.6872);
  });

  it('green driving type picks the alarm: 1 accel, 2 braking, 3 cornering', () => {
    const code = (v: number) =>
      decode(avl(0x08, [{ ...fix, eventIo: 253, io: [{ id: 253, width: 1, value: v }] }]))[0]
        ?.alarms?.[0]?.code;
    expect(code(1)).toBe('ACCELERATION');
    expect(code(2)).toBe('BRAKING');
    expect(code(3)).toBe('CORNERING');
  });

  it('crash (247) is an ACCIDENT', () => {
    const [msg] = decode(
      avl(0x08, [{ ...fix, eventIo: 247, io: [{ id: 247, width: 1, value: 1 }] }]),
    );
    expect(msg?.alarms?.[0]).toMatchObject({ code: 'ACCIDENT', severity: 'CRITICAL' });
  });

  it('an event ending (value 0) or a plain periodic record raises no alarm', () => {
    expect(
      decode(avl(0x08, [{ ...fix, eventIo: 249, io: [{ id: 249, width: 1, value: 0 }] }])).map(
        (m) => m.type,
      ),
    ).toEqual(['POSITION']);
    expect(
      decode(avl(0x08, [{ ...fix, eventIo: 239, io: [{ id: 239, width: 1, value: 1 }] }])).map(
        (m) => m.type,
      ),
    ).toEqual(['POSITION']);
  });

  it('an alarm without a fix is still raised (position omitted)', () => {
    const msgs = decode(avl(0x08, [{ eventIo: 252, io: [{ id: 252, width: 1, value: 1 }] }]));
    expect(msgs.map((m) => m.type)).toEqual(['ALARM']);
    expect(msgs[0]?.position).toBeUndefined();
  });
});

describe('Teltonika decode — malformed input', () => {
  it('rejects an unsupported codec', () => {
    const data = Buffer.concat([u8(0x7f), u8(0), u8(0)]);
    const bytes = Buffer.concat([u32(0), u32(data.length), data, u32(teltonikaCrc16(data))]);
    expect(() => decode(bytes)).toThrow(ProtocolError);
  });

  it('rejects a record-count mismatch', () => {
    const data = Buffer.concat([u8(0x08), u8(1), record(0x08, {}), u8(2)]);
    const bytes = Buffer.concat([u32(0), u32(data.length), data, u32(teltonikaCrc16(data))]);
    expect(() => decode(bytes)).toThrow(ProtocolError);
  });

  it('rejects a truncated record', () => {
    const data = Buffer.concat([u8(0x08), u8(1), record(0x08, {}).subarray(0, 20), u8(1)]);
    const bytes = Buffer.concat([u32(0), u32(data.length), data, u32(teltonikaCrc16(data))]);
    expect(() => decode(bytes)).toThrow(ProtocolError);
  });
});

describe('Teltonika codec 12', () => {
  it('decodes a command response as COMMAND_ACK', () => {
    const text = Buffer.from('DI1:0 DI2:0', 'ascii');
    const data = Buffer.concat([u8(0x0c), u8(1), u8(0x06), u32(text.length), text, u8(1)]);
    const bytes = Buffer.concat([u32(0), u32(data.length), data, u32(teltonikaCrc16(data))]);
    const [msg] = decode(bytes);
    expect(msg?.type).toBe('COMMAND_ACK');
    expect(msg?.telemetry).toMatchObject({ command: 'CODEC12', response: 'DI1:0 DI2:0' });
  });
});

describe('TeltonikaAdapter.acknowledge', () => {
  it('login verdict: 0x01 accept / 0x00 reject', () => {
    const raw = frameOne(imeiFrame());
    expect(adapter.acknowledge(raw, true)).toEqual(Buffer.from([0x01]));
    expect(adapter.acknowledge(raw, false)).toEqual(Buffer.from([0x00]));
  });

  it('AVL ack is the 4-byte record count', () => {
    const raw = frameOne(avl(0x08, [{}, {}, {}]));
    expect(adapter.acknowledge(raw, true)).toEqual(Buffer.from([0, 0, 0, 3]));
  });

  it('an unpublished AVL packet gets no ack, so the device resends', () => {
    expect(adapter.acknowledge(frameOne(WIKI_CODEC8), false)).toBeNull();
  });

  it('codec 12 responses are not acknowledged', () => {
    const text = Buffer.from('ok');
    const data = Buffer.concat([u8(0x0c), u8(1), u8(0x06), u32(text.length), text, u8(1)]);
    const raw = frameOne(
      Buffer.concat([u32(0), u32(data.length), data, u32(teltonikaCrc16(data))]),
    );
    expect(adapter.acknowledge(raw, true)).toBeNull();
  });
});

// ── end to end through the real dispatcher ──────────────────────────────────

class FakeKafka {
  public readonly published: Array<{ type: string }> = [];
  public failNext = false;
  async publish(m: { type: string }): Promise<void> {
    if (this.failNext) throw new Error('kafka down');
    this.published.push(m);
  }
  async publishSessionLifecycle(): Promise<void> {
    /* no-op */
  }
}

function harness(authOutcome: AuthOutcome) {
  const kafka = new FakeKafka();
  const sessionManager = new SessionManager(null, null, 'pod-a', {
    tcpTtlSeconds: 60,
    udpTtlSeconds: 120,
  });
  const deps: PacketDispatcherDeps = {
    authResolver: { resolve: async () => authOutcome } as unknown as AuthResolver,
    sessionManager,
    kafka: kafka as unknown as PacketDispatcherDeps['kafka'],
    rawStorage: new RawPacketStorage(),
  };
  const session = DeviceSession.open({
    transport: 'tcp',
    protocolId: 'teltonika',
    remoteAddress: '1.2.3.4',
    remotePort: 5000,
    instanceId: 'pod-a',
    now: NOW,
  });
  sessionManager.track(session);
  const written: Buffer[] = [];
  sessionManager.registerWriter(session.id as string, (d) => {
    written.push(Buffer.from(d));
    return true;
  });
  return {
    dispatcher: new PacketDispatcher(deps),
    dispatcherSessions: sessionManager,
    session,
    kafka,
    written,
  };
}

const OK: AuthOutcome = {
  ok: true,
  device: { deviceId: 'dev-1', tenantId: 'tenant-1', status: 'ACTIVE', pairedVehicleId: 'veh-1' },
} as AuthOutcome;

describe('Teltonika through the PacketDispatcher', () => {
  it('login → 0x01, then AVL records are published and acked with their count', async () => {
    const { dispatcher, session, kafka, written } = harness(OK);

    const login = await dispatcher.dispatch(session, adapter, frameOne(imeiFrame()));
    expect(login.authenticated).toBe(true);
    expect(written).toEqual([Buffer.from([0x01])]);

    const fix = { lat: 54.6872, lon: 25.2797, sats: 9 };
    await dispatcher.dispatch(
      session,
      adapter,
      frameOne(avl(0x08, [fix, { ...fix, timestamp: TS + 1000 }])),
    );
    expect(kafka.published.filter((m) => m.type === 'POSITION')).toHaveLength(2);
    expect(written[1]).toEqual(Buffer.from([0, 0, 0, 2]));
  });

  it('a refused IMEI is answered 0x00 and the session is closed', async () => {
    const { dispatcher, session, written } = harness({ ok: false, reason: 'unknown' });
    const result = await dispatcher.dispatch(session, adapter, frameOne(imeiFrame()));
    expect(result.close).toBe(true);
    expect(written).toEqual([Buffer.from([0x00])]);
  });

  it('does not ack AVL data when publishing fails (device keeps and resends it)', async () => {
    const { dispatcher, session, kafka, written } = harness(OK);
    await dispatcher.dispatch(session, adapter, frameOne(imeiFrame()));
    written.length = 0;
    kafka.failNext = true;
    await expect(
      dispatcher.dispatch(
        session,
        adapter,
        frameOne(avl(0x08, [{ lat: 54.6, lon: 25.2, sats: 9 }])),
      ),
    ).rejects.toThrow();
    expect(written).toEqual([]);
  });

  it('ignores AVL data sent before the IMEI login (no ack, nothing published)', async () => {
    const { dispatcher, session, kafka, written } = harness(OK);
    await dispatcher.dispatch(
      session,
      adapter,
      frameOne(avl(0x08, [{ lat: 54.6, lon: 25.2, sats: 9 }])),
    );
    expect(kafka.published).toHaveLength(0);
    expect(written).toEqual([]);
  });
});

describe('Teltonika over a real TCP socket', () => {
  it('IMEI → 0x01, AVL split across TCP segments → published and acked', async () => {
    const h = harness(OK);
    const listener = new TcpListener({
      adapter,
      port: 0,
      host: '127.0.0.1',
      idleTimeoutMs: 5_000,
      openSession: () => h.session,
      // Same wiring as GatewayModule: the session writer is the socket.
      onOpen: (ctx) => {
        h.dispatcherSessions.registerWriter(ctx.session.id as string, (d) => ctx.socket.write(d));
      },
      onPacket: async (ctx, payload) => {
        const raw = {
          protocolId: adapter.id,
          payload,
          receivedAt: NOW,
          direction: 'INBOUND' as const,
        };
        const r = await h.dispatcher.dispatch(ctx.session, adapter, raw as unknown as RawPacket);
        return !r.close;
      },
    });
    await listener.listen();
    // biome-ignore lint/suspicious/noExplicitAny: reach the bound ephemeral port
    const port = ((listener as any).server.address() as AddressInfo).port;

    const received: Buffer[] = [];
    const waitFor = (bytes: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (Buffer.concat(received).length >= bytes) resolve();
          else setTimeout(check, 5);
        };
        check();
      });

    const sock = createConnection({ port, host: '127.0.0.1' });
    sock.on('data', (d) => received.push(d));
    await new Promise<void>((r) => sock.once('connect', () => r()));

    sock.write(imeiFrame());
    await waitFor(1);
    expect(Buffer.concat(received)).toEqual(Buffer.from([0x01]));

    const packet = avl(0x08, [
      { lat: 54.6872, lon: 25.2797, sats: 9 },
      { lat: 54.6873, lon: 25.2798, sats: 9, timestamp: TS + 1000 },
    ]);
    sock.write(packet.subarray(0, 25));
    await new Promise((r) => setTimeout(r, 20));
    sock.write(packet.subarray(25));
    await waitFor(5);
    expect(Buffer.concat(received)).toEqual(Buffer.from([0x01, 0, 0, 0, 2]));
    expect(h.kafka.published.filter((m) => m.type === 'POSITION')).toHaveLength(2);

    sock.destroy();
    await listener.close();
  });
});

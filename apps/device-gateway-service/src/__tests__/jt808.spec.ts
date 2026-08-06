import { describe, expect, it } from '@jest/globals';
import type { RawPacket } from '../domain/raw-packet.js';
import { Jt808Adapter } from '../infrastructure/adapters/jt808/jt808.adapter.js';
import {
  JT808_FLAG,
  escape808,
  jt808Checksum,
} from '../infrastructure/adapters/jt808/jt808.frames.js';
import { MSG, stringToBcd } from '../infrastructure/adapters/jt808/jt808.header.js';
import { ByteReader, NEED_MORE } from '../infrastructure/transport/byte-reader.js';

/** Narrow a frame() result to a RawPacket, asserting non-NEED_MORE. */
function unwrap(raw: RawPacket | typeof NEED_MORE): RawPacket {
  if (typeof raw === 'symbol') throw new Error('frame returned NEED_MORE');
  return raw;
}

const PHONE = '012345678901'; // 12 BCD digits (2013)
const NOW = new Date('2026-08-06T10:00:00Z');

/**
 * Build a valid JT808 device→server frame on the wire (still stuffed): the framer
 * will unstuff + checksum it. Layout: 0x7e [msgId(2) bodyProps(2) phone(BCD 6)
 * msgSn(2) body cksum(1)] 0x7e, with 0x7d/0x7e escaping applied between delimiters.
 */
function jt808Frame(msgId: number, body: Buffer, msgSn = 1, phone = PHONE): Buffer {
  const phoneBytes = stringToBcd(phone, 6);
  const parts: Buffer[] = [
    writeU16(msgId),
    writeU16(body.length & 0x03ff), // 2013 bodyProps (no version bit)
    phoneBytes,
    writeU16(msgSn),
    body,
  ];
  const region = Buffer.concat(parts);
  const cksum = jt808Checksum(region);
  const regionWithCk = Buffer.concat([region, Buffer.from([cksum])]);
  const escaped = escape808(regionWithCk);
  return Buffer.concat([Buffer.from([JT808_FLAG]), escaped, Buffer.from([JT808_FLAG])]);
}

function writeU16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v & 0xffff, 0);
  return b;
}

function writeU32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0, 0);
  return b;
}

/** Build a canonical 0x0200 location body (28-byte fixed block + optional IO). */
function locationBody(opts: {
  alarm?: number;
  status?: number;
  lat?: number;
  lng?: number;
  alt?: number;
  speed?: number;
  dir?: number;
  time?: Buffer; // BCD[6]
  io?: Buffer;
}): Buffer {
  const alarm = opts.alarm ?? 0;
  const status = opts.status ?? 1 << 1; // bit1 = fix valid by default
  const lat = Math.round((opts.lat ?? 22.9382) * 1_000_000);
  const lng = Math.round((opts.lng ?? 113.3827) * 1_000_000);
  const alt = opts.alt ?? 55;
  const speed = (opts.speed ?? 0) * 10;
  const dir = opts.dir ?? 0;
  const time = opts.time ?? Buffer.from([0x26, 0x08, 0x06, 0x10, 0x00, 0x00]); // 260806 100000
  const fixed = Buffer.concat([
    writeU32(alarm),
    writeU32(status),
    writeU32(lat),
    writeU32(lng),
    Buffer.from([(alt >> 8) & 0xff, alt & 0xff]), // signed WORD altitude
    writeU16(speed),
    writeU16(dir),
    time,
  ]);
  return opts.io ? Buffer.concat([fixed, opts.io]) : fixed;
}

describe('Jt808Adapter.detect', () => {
  const adapter = new Jt808Adapter();
  it('recognizes the 0x7e leading delimiter', () => {
    expect(adapter.detect(Buffer.from([0x7e, 0x01, 0x00])).confidence).toBeGreaterThan(0.8);
  });
  it('rejects foreign magic', () => {
    expect(adapter.detect(Buffer.from([0x78, 0x78])).confidence).toBe(0);
  });
});

describe('Jt808Adapter.frame + escape + checksum', () => {
  const adapter = new Jt808Adapter();

  it('frames a complete register (0x0100) packet', () => {
    const frame = jt808Frame(MSG.REGISTER, Buffer.alloc(0));
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    expect(reader.available).toBe(0);
    // Round-trip: the unstuffed payload is 0x7e-delimited and re-checksums.
    expect(raw.payload[0]).toBe(JT808_FLAG);
    expect(raw.payload[raw.payload.length - 1]).toBe(JT808_FLAG);
  });

  it('returns NEED_MORE for a partial frame', () => {
    const frame = jt808Frame(MSG.REGISTER, Buffer.alloc(0)).subarray(0, 4);
    const reader = new ByteReader();
    reader.append(frame);
    expect(adapter.frame(reader, NOW)).toBe(NEED_MORE);
  });

  it('skips leading garbage before the flag', () => {
    const frame = jt808Frame(MSG.HEARTBEAT, Buffer.alloc(0));
    const reader = new ByteReader();
    reader.append(Buffer.from([0xff, 0xee, 0x00]));
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    // Decode must succeed → confirms the framed packet is intact.
    expect(() => adapter.decode(raw)).not.toThrow();
  });

  it('frames two back-to-back packets', () => {
    const f1 = jt808Frame(MSG.REGISTER, Buffer.alloc(0), 1);
    const f2 = jt808Frame(MSG.HEARTBEAT, Buffer.alloc(0), 2);
    const reader = new ByteReader();
    reader.append(Buffer.concat([f1, f2]));
    unwrap(adapter.frame(reader, NOW));
    unwrap(adapter.frame(reader, NOW));
    expect(reader.available).toBe(0);
  });

  it('survives a byte-stuffing round-trip (body containing 0x7e and 0x7d)', () => {
    // A terminal-control body that happens to contain delimiters/escape bytes.
    const body = Buffer.from([0x7e, 0x7d, 0x42, 0x7e, 0x7d]);
    const frame = jt808Frame(MSG.TERMINAL_CONTROL, body);
    // On the wire the 0x7e bytes must be stuffed → no raw 0x7e between delimiters.
    const inner = frame.subarray(1, frame.length - 1);
    expect(inner.includes(0x7e)).toBe(false);
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    // The unstuffed region must contain the original body bytes.
    expect(raw.payload.includes(0x7e)).toBe(true);
    expect(raw.payload.includes(0x7d)).toBe(true);
  });

  it('throws ProtocolError on a checksum mismatch', () => {
    const frame = jt808Frame(MSG.HEARTBEAT, Buffer.alloc(0));
    // Corrupt the checksum: it is the byte just before the trailing 0x7e (in the
    // stuffed stream it occupies a fixed position for a zero-length body).
    const corrupted = Buffer.from(frame);
    const lastCk = corrupted.length - 2;
    corrupted[lastCk] = (corrupted[lastCk] ?? 0) ^ 0xff;
    const reader = new ByteReader();
    reader.append(corrupted);
    expect(() => adapter.frame(reader, NOW)).toThrow(/BCC/i);
  });
});

describe('Jt808Adapter.decode', () => {
  const adapter = new Jt808Adapter();

  it('decodes 0x0100 register → LOGIN with the phone as serialOrImei', () => {
    const body = Buffer.concat([
      writeU16(11), // province
      writeU16(1100), // city
      Buffer.from('MK001', 'ascii'), // manufacturer (5)
    ]);
    const frame = jt808Frame(MSG.REGISTER, body);
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('LOGIN');
    expect(msg.protocolId).toBe('jt808');
    expect(msg.serialOrImei).toBe(PHONE); // BCD phone → implicit login
    expect(msg.deviceId).toBe(''); // filled by auth/resolve later
    expect(msg.checksum).toMatch(/^[0-9a-f]{64}$/); // SHA-256
    expect(msg.telemetry?.provinceId).toBe(11);
    expect(msg.telemetry?.manufacturerId).toBe('MK001');
  });

  it('decodes 0x0200 location → POSITION with /1e6 coords, speed, time', () => {
    const frame = jt808Frame(
      MSG.LOCATION,
      locationBody({ lat: 22.9382, lng: 113.3827, speed: 42 }),
    );
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('POSITION');
    expect(msg.position?.latitude).toBeCloseTo(22.9382, 5);
    expect(msg.position?.longitude).toBeCloseTo(113.3827, 5);
    expect(msg.position?.speedKph).toBeCloseTo(42, 1);
    expect(msg.position?.altitudeM).toBe(55);
    expect(msg.position?.timestamp.toISOString()).toBe('2026-08-06T10:00:00.000Z');
    expect(msg.position?.ignitionOn).toBe(false); // ACC bit not set in default status
    expect(msg.telemetry?.valid).toBe(true); // bit1 fix valid
  });

  it('decodes S/W sign from status bits (bit2=south, bit3=west)', () => {
    const status = (1 << 1) | (1 << 2) | (1 << 3); // valid + south + west
    const frame = jt808Frame(MSG.LOCATION, locationBody({ status, lat: 22.9382, lng: 113.3827 }));
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.position?.latitude).toBeLessThan(0);
    expect(msg.position?.longitude).toBeLessThan(0);
  });

  it('decodes 0x0200 with alarm bits set → ALARM', () => {
    // bit0 emergency (SOS) + bit1 overspeed
    const alarm = (1 << 0) | (1 << 1);
    const frame = jt808Frame(MSG.LOCATION, locationBody({ alarm }));
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('ALARM');
    const codes = msg.alarms?.map((a) => a.code);
    expect(codes).toContain('EMERGENCY');
    expect(codes).toContain('OVERSPEED');
    expect(msg.alarms?.find((a) => a.code === 'EMERGENCY')?.severity).toBe('CRITICAL');
    expect(msg.position).toBeDefined(); // alarm still carries the position
  });

  it('decodes IO TLV items (odometer + satellites) from the position tail', () => {
    const io = Buffer.concat([
      Buffer.from([0x31, 0x01, 0x08]), // id=0x31 satellites, len=1, val=8
      Buffer.from([0x01, 0x04]), // id=0x01 mileage, len=4
      writeU32(12345), // 12345 * 0.1 km = 1234.5 km
    ]);
    const frame = jt808Frame(MSG.LOCATION, locationBody({ io }));
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.position?.satellites).toBe(8);
    expect(msg.telemetry?.odometerKm).toBeCloseTo(1234.5, 1);
  });

  it('decodes 0x0301 event report → ALARM', () => {
    const frame = jt808Frame(MSG.EVENT_REPORT, Buffer.from([0x11])); // accident
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('ALARM');
    expect(msg.alarms?.[0]?.code).toBe('ACCIDENT');
    expect(msg.alarms?.[0]?.severity).toBe('CRITICAL');
  });

  it('decodes 0x0002 heartbeat → HEARTBEAT', () => {
    const frame = jt808Frame(MSG.HEARTBEAT, Buffer.alloc(0));
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('HEARTBEAT');
    expect(msg.serialOrImei).toBe(PHONE);
  });

  it('decodes 0x0001 terminal general response → COMMAND_ACK', () => {
    const body = Buffer.concat([writeU16(7), writeU16(MSG.TERMINAL_CONTROL), Buffer.from([0x00])]);
    const frame = jt808Frame(MSG.TERMINAL_GENERAL_RESPONSE, body);
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('COMMAND_ACK');
    expect(msg.telemetry?.seq).toBe(7);
    expect(msg.telemetry?.result).toBe(0);
  });

  it('throws ProtocolError on an unsupported message id', () => {
    const frame = jt808Frame(0xeeee, Buffer.alloc(0));
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    expect(() => adapter.decode(raw)).toThrow(/not supported/);
  });
});

describe('Jt808Adapter.encode', () => {
  const adapter = new Jt808Adapter();

  it('encodes a LOGIN_ACK as 0x8100 that re-validates under BCC + stuffing', () => {
    const buf = adapter.encode({
      deviceId: 'd',
      type: 'LOGIN_ACK',
      payload: { phone: PHONE, msgSn: 5, authCode: 'AUTH1234' },
    });
    expect(buf[0]).toBe(JT808_FLAG);
    expect(buf[buf.length - 1]).toBe(JT808_FLAG);
    // Re-frame the produced bytes through the adapter to confirm validity.
    const reader = new ByteReader();
    reader.append(buf);
    const raw = unwrap(adapter.frame(reader, NOW));
    expect(raw.payload[0]).toBe(JT808_FLAG);
    // Header msgId should be 0x8100.
    expect(raw.payload.readUInt16BE(1)).toBe(MSG.REGISTER_RESPONSE);
  });

  it('encodes a HEARTBEAT_ACK as 0x8001 platform general response', () => {
    const buf = adapter.encode({
      deviceId: 'd',
      type: 'HEARTBEAT_ACK',
      payload: { phone: PHONE, msgSn: 9, ackedMessageId: MSG.HEARTBEAT, result: 0 },
    });
    const reader = new ByteReader();
    reader.append(buf);
    const raw = unwrap(adapter.frame(reader, NOW));
    expect(raw.payload.readUInt16BE(1)).toBe(MSG.PLATFORM_GENERAL_RESPONSE);
  });

  it('encodes a 0x8108 upgrade frame and increments the outbound msgSn', () => {
    const adapter2 = new Jt808Adapter();
    const before = (adapter2 as unknown as { encoder: { msgSn: number } }).encoder.msgSn;
    const buf = adapter2.encode({
      deviceId: 'd',
      type: 'TELEMETRY',
      payload: {
        phone: PHONE,
        command: 'UPGRADE',
        upgradeType: 0,
        manufacturer: 'MK001',
        version: 'v1.2',
        package: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      },
    });
    const after = (adapter2 as unknown as { encoder: { msgSn: number } }).encoder.msgSn;
    expect(after).toBe((before + 1) & 0xffff);
    const reader = new ByteReader();
    reader.append(buf);
    const raw = unwrap(adapter2.frame(reader, NOW));
    expect(raw.payload.readUInt16BE(1)).toBe(MSG.TERMINAL_UPGRADE);
    // Body must contain the version string and the package bytes.
    expect(raw.payload.includes(Buffer.from('v1.2', 'ascii'))).toBe(true);
    expect(raw.payload.includes(0xde)).toBe(true);
  });

  it('returns an empty buffer when the command has no phone/identity', () => {
    expect(adapter.encode({ deviceId: '', type: 'HEARTBEAT_ACK', payload: {} }).length).toBe(0);
  });
});

import { describe, expect, it } from '@jest/globals';
import type { RawPacket } from '../domain/raw-packet.js';
import { Gt06Adapter } from '../infrastructure/adapters/gt06/gt06.adapter.js';
import { GT06_PROTOCOL, gt06Crc16 } from '../infrastructure/adapters/gt06/gt06.frames.js';
import { ByteReader, NEED_MORE } from '../infrastructure/transport/byte-reader.js';

/** Narrow a frame() result to a RawPacket, asserting non-NEED_MORE. */
function unwrap(raw: RawPacket | typeof NEED_MORE): RawPacket {
  if (typeof raw === 'symbol') throw new Error('frame returned NEED_MORE');
  return raw;
}

/**
 * Build a valid GT06 frame for tests: start(2) proto(1) data infoSerial(2) crc(2) stop(2).
 */
function gt06Frame(protocol: number, data: Buffer, infoSerial = 0x0001): Buffer {
  const infoHi = (infoSerial >> 8) & 0xff;
  const infoLo = infoSerial & 0xff;
  const crcRegion = Buffer.concat([Buffer.from([protocol]), data, Buffer.from([infoHi, infoLo])]);
  const crc = gt06Crc16(crcRegion);
  return Buffer.from([
    0x78,
    0x78,
    protocol,
    ...data,
    infoHi,
    infoLo,
    (crc >> 8) & 0xff,
    crc & 0xff,
    0x0d,
    0x0a,
  ]);
}

const NOW = new Date('2026-08-05T10:00:00Z');

describe('Gt06Adapter.detect', () => {
  const adapter = new Gt06Adapter();
  it('recognizes the 0x78 0x78 start marker', () => {
    expect(adapter.detect(Buffer.from([0x78, 0x78, 0x01])).confidence).toBeGreaterThan(0.9);
  });
  it('rejects foreign magic', () => {
    expect(adapter.detect(Buffer.from([0xab, 0xcd])).confidence).toBe(0);
  });
});

describe('Gt06Adapter.frame + CRC', () => {
  const adapter = new Gt06Adapter();

  it('frames a complete LOGIN packet', () => {
    const imei = Buffer.from('1234567890123456', 'hex'); // 8 BCD bytes
    const frame = gt06Frame(GT06_PROTOCOL.LOGIN, imei);
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    expect(raw.payload).toEqual(frame);
    expect(reader.available).toBe(0);
  });

  it('returns NEED_MORE for a partial frame', () => {
    const imei = Buffer.from('1234567890123456', 'hex');
    const frame = gt06Frame(GT06_PROTOCOL.LOGIN, imei).subarray(0, 6); // truncated
    const reader = new ByteReader();
    reader.append(frame);
    const result = adapter.frame(reader, NOW);
    expect(result).toBe(NEED_MORE);
  });

  it('skips leading garbage bytes before the start marker', () => {
    const imei = Buffer.from('1234567890123456', 'hex');
    const frame = gt06Frame(GT06_PROTOCOL.LOGIN, imei);
    const reader = new ByteReader();
    reader.append(Buffer.from([0xff, 0xee, 0x00])); // garbage
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    expect(raw.payload).toEqual(frame);
  });

  it('frames two back-to-back packets', () => {
    const imei = Buffer.from('1234567890123456', 'hex');
    const f1 = gt06Frame(GT06_PROTOCOL.LOGIN, imei, 1);
    const f2 = gt06Frame(GT06_PROTOCOL.HEARTBEAT, Buffer.alloc(0), 2);
    const reader = new ByteReader();
    reader.append(Buffer.concat([f1, f2]));
    const r1 = unwrap(adapter.frame(reader, NOW));
    const r2 = unwrap(adapter.frame(reader, NOW));
    expect(r1.payload).toEqual(f1);
    expect(r2.payload).toEqual(f2);
    expect(reader.available).toBe(0);
  });
});

describe('Gt06Adapter.decode', () => {
  const adapter = new Gt06Adapter();

  it('decodes LOGIN to a DeviceMessage with the IMEI as serialOrImei', () => {
    const imei = Buffer.from('0123456789012345', 'hex');
    const frame = gt06Frame(GT06_PROTOCOL.LOGIN, imei);
    const r = new ByteReader();
    r.append(frame);
    const raw = unwrap(adapter.frame(r, NOW));
    const msgs = adapter.decode(raw);
    const msg = msgs[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('LOGIN');
    expect(msg.serialOrImei).toBe('123456789012345'); // leading 0 nibble stripped → 15 digits
    expect(msg.deviceId).toBe(''); // filled by auth/resolve later
    expect(msg.tenantId).toBe('');
    expect(msg.protocolId).toBe('gt06');
    expect(msg.checksum).toMatch(/^[0-9a-f]{64}$/); // SHA-256
  });

  it('decodes HEARTBEAT with telemetry (ignition from terminal-info byte)', () => {
    // HEARTBEAT data = terminalInfo(1) voltage(1). bit 2 of terminalInfo = ignition.
    const data = Buffer.from([0x04, 0x03]); // ignition on, voltage level 3
    const frame = gt06Frame(GT06_PROTOCOL.HEARTBEAT, data);
    const r = new ByteReader();
    r.append(frame);
    const raw = unwrap(adapter.frame(r, NOW));
    const msgs = adapter.decode(raw);
    const msg = msgs[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('HEARTBEAT');
    expect(msg.telemetry?.ignitionOn).toBe(true);
    expect(msg.telemetry?.voltageLevel).toBe(3);
  });

  it('encodes a LOGIN_ACK that re-validates under the same CRC rule', () => {
    const adapter2 = new Gt06Adapter();
    const buf = adapter2.encode({ deviceId: 'd', type: 'LOGIN_ACK', payload: { infoSerial: 1 } });
    // Re-frame the produced bytes through the adapter to confirm structural validity:
    // start(2) len(1)=05 proto(1) infoHi infoLo crcHi crcLo stop(2)
    expect(buf[0]).toBe(0x78);
    expect(buf[1]).toBe(0x78);
    expect(buf[2]).toBe(0x05);
    expect(buf[3]).toBe(GT06_PROTOCOL.LOGIN);
    // verify crc
    const crc = gt06Crc16(buf.subarray(3, 6));
    expect(((buf[6] ?? 0) << 8) | (buf[7] ?? 0)).toBe(crc);
    expect(buf[buf.length - 2]).toBe(0x0d);
    expect(buf[buf.length - 1]).toBe(0x0a);
  });

  it('throws ProtocolError on an unsupported protocol number', () => {
    // 1 byte of data keeps the frame at the minimum 10 bytes (passes length check)
    // so decode reaches the protocol-number switch and rejects 0xee.
    const frame = gt06Frame(0xee, Buffer.from([0x00]));
    const r = new ByteReader();
    r.append(frame);
    const raw = unwrap(adapter.frame(r, NOW));
    expect(() => adapter.decode(raw)).toThrow(/not supported/);
  });
});

/**
 * Build a GT06 GPS data block: date(6 BCD) lat(4 BE) lng(4 BE) speed(1) courseStatus(2 BE).
 * Coordinates are encoded as degrees × 60 × 30000 (minutes × 30000). The course/status
 * word packs heading (bits 0–9), lat hemisphere (bit 10: 1=N), lng hemisphere (bit 11:
 * 0=E), fix-valid (bit 12).
 */
function gpsDataBlock(opts: {
  lat: number;
  lng: number;
  speed?: number; // knots
  heading?: number; // 0..359
  north?: boolean;
  east?: boolean;
  fixValid?: boolean;
}): Buffer {
  const latRaw = Math.round(Math.abs(opts.lat) * 60 * 30000);
  const lngRaw = Math.round(Math.abs(opts.lng) * 60 * 30000);
  const speed = (opts.speed ?? 0) & 0xff;
  let courseStatus = (opts.heading ?? 0) & 0x03ff; // bits 0–9
  if (opts.north ?? true) courseStatus |= 0x0400; // bit 10 = N
  if (!(opts.east ?? true)) courseStatus |= 0x0800; // bit 11 set = W
  if (opts.fixValid ?? true) courseStatus |= 0x1000; // bit 12 = valid
  // Date BCD: 26 08 06 10 00 00 (2026-08-06 10:00:00 UTC).
  const date = Buffer.from([0x26, 0x08, 0x06, 0x10, 0x00, 0x00]);
  const buf = Buffer.alloc(17);
  date.copy(buf, 0);
  buf.writeUInt32BE(latRaw, 6);
  buf.writeUInt32BE(lngRaw, 10);
  buf[14] = speed;
  buf.writeUInt16BE(courseStatus, 15);
  return buf;
}

/** Frame + decode a GT06 protocol packet, returning the first message. */
function decodeFrame(protocol: number, data: Buffer) {
  const adapter = new Gt06Adapter();
  const frame = gt06Frame(protocol, data);
  const reader = new ByteReader();
  reader.append(frame);
  const raw = unwrap(adapter.frame(reader, NOW));
  const msg = adapter.decode(raw)[0];
  if (!msg) throw new Error('decode produced no message');
  return msg;
}

describe('Gt06Adapter GPS coordinate signs (Sprint 6 bug fix)', () => {
  it('decodes North + East coordinates with correct sign', () => {
    // Beijing: ~39.9 N, 116.4 E
    const msg = decodeFrame(GT06_PROTOCOL.GPS, gpsDataBlock({ lat: 39.9, lng: 116.4 }));
    expect(msg.type).toBe('POSITION');
    expect(msg.position?.latitude).toBeGreaterThan(0); // North
    expect(msg.position?.longitude).toBeGreaterThan(0); // East
    expect(msg.position?.latitude).toBeCloseTo(39.9, 4);
    expect(msg.position?.longitude).toBeCloseTo(116.4, 4);
  });

  it('decodes South latitude (Sydney) — regression for the old Math.abs bug', () => {
    // Sydney: ~33.85 S, 151.21 E
    const msg = decodeFrame(
      GT06_PROTOCOL.GPS,
      gpsDataBlock({ lat: 33.85, lng: 151.21, north: false, east: true }),
    );
    expect(msg.position?.latitude).toBeLessThan(0); // South → negative
    expect(msg.position?.longitude).toBeGreaterThan(0); // East
    expect(msg.position?.latitude).toBeCloseTo(-33.85, 3);
    expect(msg.position?.longitude).toBeCloseTo(151.21, 3);
  });

  it('decodes West longitude (San Francisco) — regression for the old Math.abs bug', () => {
    // San Francisco: ~37.77 N, 122.42 W
    const msg = decodeFrame(
      GT06_PROTOCOL.GPS,
      gpsDataBlock({ lat: 37.77, lng: 122.42, north: true, east: false }),
    );
    expect(msg.position?.latitude).toBeGreaterThan(0); // North
    expect(msg.position?.longitude).toBeLessThan(0); // West → negative
    expect(msg.position?.latitude).toBeCloseTo(37.77, 3);
    expect(msg.position?.longitude).toBeCloseTo(-122.42, 3);
  });

  it('decodes South + West (South America) — both signs negative', () => {
    // Lima: ~12.05 S, 77.04 W
    const msg = decodeFrame(
      GT06_PROTOCOL.GPS,
      gpsDataBlock({ lat: 12.05, lng: 77.04, north: false, east: false }),
    );
    expect(msg.position?.latitude).toBeLessThan(0);
    expect(msg.position?.longitude).toBeLessThan(0);
  });

  it('extracts heading, speed, fix-valid, and time from the course/status word', () => {
    const msg = decodeFrame(
      GT06_PROTOCOL.GPS,
      gpsDataBlock({ lat: 22.5, lng: 114.0, speed: 52, heading: 180 }),
    );
    // Speed 52 knots → ~96 kph.
    expect(msg.position?.speedKph).toBeCloseTo(Math.round(52 * 1.852), 0);
    expect(msg.position?.headingDeg).toBe(180);
    expect(msg.telemetry?.fixValid).toBe(true);
    expect(msg.position?.timestamp.toISOString()).toBe('2026-08-06T10:00:00.000Z');
  });

  it('matches the spec worked example 0x154C → North, East, course 332°', () => {
    // Build a block whose course/status word is exactly 0x154C.
    const latRaw = Math.round(22.5 * 60 * 30000);
    const lngRaw = Math.round(114.0 * 60 * 30000);
    const buf = Buffer.alloc(17);
    Buffer.from([0x26, 0x08, 0x06, 0x10, 0x00, 0x00]).copy(buf, 0);
    buf.writeUInt32BE(latRaw, 6);
    buf.writeUInt32BE(lngRaw, 10);
    buf[14] = 0; // speed
    buf.writeUInt16BE(0x154c, 15); // the canonical example word
    const msg = decodeFrame(GT06_PROTOCOL.GPS, buf);
    // 0x154C: bit10=1 (N), bit11=0 (E), bits0-9=332, bit12=1 (valid).
    expect(msg.position?.latitude).toBeGreaterThan(0); // North
    expect(msg.position?.longitude).toBeGreaterThan(0); // East
    expect(msg.position?.headingDeg).toBe(332);
    expect(msg.telemetry?.fixValid).toBe(true);
  });
});

describe('Gt06Adapter ALARM (0x05)', () => {
  it('decodes an SOS alarm with mapped severity and embedded position', () => {
    const block = Buffer.concat([Buffer.from([0x01]), gpsDataBlock({ lat: 22.9, lng: 113.9 })]);
    const msg = decodeFrame(GT06_PROTOCOL.ALARM, block);
    expect(msg.type).toBe('ALARM');
    expect(msg.alarms?.[0]?.code).toBe('SOS');
    expect(msg.alarms?.[0]?.severity).toBe('CRITICAL');
    expect(msg.alarms?.[0]?.source).toBe('0x01');
    expect(msg.position).toBeDefined();
    expect(msg.telemetry?.alarmType).toBe(0x01);
  });

  it('maps a power-cut alarm to CRITICAL and overspeed to WARNING', () => {
    const mk = (type: number) => {
      const block = Buffer.concat([Buffer.from([type]), gpsDataBlock({ lat: 22, lng: 114 })]);
      return decodeFrame(GT06_PROTOCOL.ALARM, block);
    };
    expect(mk(0x02).alarms?.[0]?.code).toBe('POWER_CUT');
    expect(mk(0x02).alarms?.[0]?.severity).toBe('CRITICAL');
    expect(mk(0x06).alarms?.[0]?.code).toBe('OVERSPEED');
    expect(mk(0x06).alarms?.[0]?.severity).toBe('WARNING');
    expect(mk(0x0a).alarms?.[0]?.code).toBe('LOW_BATTERY');
  });

  it('preserves correct coordinate signs inside the alarm embedded GPS block', () => {
    // Alarm with a South/West position — signs must still decode correctly.
    const block = Buffer.concat([
      Buffer.from([0x03]), // shock
      gpsDataBlock({ lat: 33.85, lng: 122.42, north: false, east: false }),
    ]);
    const msg = decodeFrame(GT06_PROTOCOL.ALARM, block);
    expect(msg.type).toBe('ALARM');
    expect(msg.position?.latitude).toBeLessThan(0); // South
    expect(msg.position?.longitude).toBeLessThan(0); // West
  });

  it('maps an unknown alarm type to a generic label (no alarm lost)', () => {
    const block = Buffer.concat([Buffer.from([0xff]), gpsDataBlock({ lat: 22, lng: 114 })]);
    const msg = decodeFrame(GT06_PROTOCOL.ALARM, block);
    expect(msg.alarms?.[0]?.code).toBe('GT06_ALARM_0xff');
    expect(msg.alarms?.[0]?.severity).toBe('INFO');
  });
});

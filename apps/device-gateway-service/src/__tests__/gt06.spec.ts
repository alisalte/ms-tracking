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

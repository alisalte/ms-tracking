import { describe, expect, it } from '@jest/globals';
import type { RawPacket } from '../domain/raw-packet.js';
import { MeitrackAdapter } from '../infrastructure/adapters/meitrack/meitrack.adapter.js';
import { meitrackChecksum } from '../infrastructure/adapters/meitrack/meitrack.frames.js';
import { ByteReader, NEED_MORE } from '../infrastructure/transport/byte-reader.js';

/** Narrow a frame() result to a RawPacket, asserting non-NEED_MORE. */
function unwrap(raw: RawPacket | typeof NEED_MORE): RawPacket {
  if (typeof raw === 'symbol') throw new Error('frame returned NEED_MORE');
  return raw;
}

const IMEI = '135790246811220';
const NOW = new Date('2026-08-05T10:00:00Z');

/**
 * Build a valid device→server Meitrack frame: `$$A<len>,<content>*<cc>\r\n`.
 * Length is decimal (counted from the first comma through \r\n inclusive); checksum
 * is the modular byte sum mod 256, %02X — both computed via the adapter helpers so
 * the test mirrors exactly what the framer validates.
 */
function meitrackFrame(content: string): Buffer {
  const commaBlock = `,${content}`;
  const length = commaBlock.length + 1 + 2 + 2; // '*' + checksum(2) + \r\n(2)
  // Devices zero-pad the inbound length to 4 digits; the framer parses any digits.
  const head = `$$A${String(length).padStart(4, '0')}`;
  const checksumRegion = `${head}${commaBlock}*`;
  const checksum = meitrackChecksum(Buffer.from(checksumRegion, 'ascii'));
  return Buffer.from(`${checksumRegion}${checksum}\r\n`, 'ascii');
}

/** A canonical AAA tracking body with explicit field positions (see decode.ts). */
function trackingBody(event: number, lat = '22.93820', lng = '113.38270'): string {
  // imei, command, event, lat, lng, YYMMDDHHMMSS, validity, sats, rssi, speed,
  // heading, hdop, alt, odo, runtime, mcc|mnc|lac|cid, input, output, batt|power|...
  return [
    IMEI,
    'AAA',
    event,
    lat,
    lng,
    '260805100000',
    'A',
    '8',
    '31',
    '0.0',
    '0',
    '1.2',
    '55',
    '1200',
    '3600',
    '460|0|1234|5678',
    '01',
    '00',
    '3.95|12.4|3.9|3.9|4.1',
  ].join(',');
}

describe('MeitrackAdapter.detect', () => {
  const adapter = new MeitrackAdapter();
  it('recognizes the "$$" start marker', () => {
    expect(adapter.detect(Buffer.from('$$A', 'ascii')).confidence).toBeGreaterThan(0.9);
  });
  it('rejects foreign magic', () => {
    expect(adapter.detect(Buffer.from([0xab, 0xcd])).confidence).toBe(0);
  });
  it('does not match the GT06 start marker', () => {
    expect(adapter.detect(Buffer.from([0x78, 0x78])).confidence).toBe(0);
  });
});

describe('MeitrackAdapter.frame + checksum', () => {
  const adapter = new MeitrackAdapter();

  it('frames a complete tracking packet', () => {
    const frame = meitrackFrame(trackingBody(0));
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    expect(raw.payload).toEqual(frame);
    expect(reader.available).toBe(0);
  });

  it('returns NEED_MORE for a partial frame', () => {
    const frame = meitrackFrame(trackingBody(0)).subarray(0, 10); // truncated mid-length
    const reader = new ByteReader();
    reader.append(frame);
    expect(adapter.frame(reader, NOW)).toBe(NEED_MORE);
  });

  it('skips leading garbage bytes before the start marker', () => {
    const frame = meitrackFrame(trackingBody(0));
    const reader = new ByteReader();
    reader.append(Buffer.from([0xff, 0xee, 0x00]));
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    expect(raw.payload).toEqual(frame);
  });

  it('frames two back-to-back packets', () => {
    const f1 = meitrackFrame(trackingBody(0));
    const f2 = meitrackFrame(`${IMEI},D82,A11,OK`);
    const reader = new ByteReader();
    reader.append(Buffer.concat([f1, f2]));
    const r1 = unwrap(adapter.frame(reader, NOW));
    const r2 = unwrap(adapter.frame(reader, NOW));
    expect(r1.payload).toEqual(f1);
    expect(r2.payload).toEqual(f2);
    expect(reader.available).toBe(0);
  });

  it('throws ProtocolError on a checksum mismatch', () => {
    const frame = meitrackFrame(trackingBody(0));
    // Corrupt the checksum (two chars before \r\n).
    const corrupted = Buffer.from(frame);
    const lastCk = corrupted.length - 4;
    corrupted[lastCk] = corrupted[lastCk] === 0x41 ? 0x42 : 0x41;
    const reader = new ByteReader();
    reader.append(corrupted);
    expect(() => adapter.frame(reader, NOW)).toThrow(/checksum/i);
  });

  it('accepts an unpadded length (devices may send variable digit counts)', () => {
    // Build with a 2-digit length to prove the framer parses digits, not a fixed width.
    const content = trackingBody(0);
    const commaBlock = `,${content}`;
    const length = commaBlock.length + 1 + 2 + 2;
    const head = `$$A${length}`; // no zero-pad
    const region = `${head}${commaBlock}*`;
    const frame = Buffer.from(
      `${region}${meitrackChecksum(Buffer.from(region, 'ascii'))}\r\n`,
      'ascii',
    );
    const reader = new ByteReader();
    reader.append(frame);
    const raw = unwrap(adapter.frame(reader, NOW));
    expect(raw.payload).toEqual(frame);
  });
});

describe('MeitrackAdapter.decode', () => {
  const adapter = new MeitrackAdapter();

  it('decodes a POSITION (event 0) with IMEI, coords, speed, time, sats', () => {
    const frame = meitrackFrame(trackingBody(0, '22.93820', '113.38270'));
    const r = new ByteReader();
    r.append(frame);
    const raw = unwrap(adapter.frame(r, NOW));
    const msgs = adapter.decode(raw);
    const msg = msgs[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('POSITION');
    expect(msg.protocolId).toBe('meitrack');
    expect(msg.serialOrImei).toBe(IMEI); // IMEI on every message → implicit login
    expect(msg.deviceId).toBe(''); // filled by auth/resolve later
    expect(msg.tenantId).toBe('');
    expect(msg.checksum).toMatch(/^[0-9a-f]{64}$/); // SHA-256
    expect(msg.position?.latitude).toBeCloseTo(22.9382, 4);
    expect(msg.position?.longitude).toBeCloseTo(113.3827, 4);
    expect(msg.position?.satellites).toBe(8);
    expect(msg.position?.altitudeM).toBe(55);
    expect(msg.position?.timestamp.toISOString()).toBe('2026-08-05T10:00:00.000Z');
    expect(msg.telemetry?.odometerKm).toBeCloseTo(1.2, 3); // 1200 m → 1.2 km
    expect(msg.telemetry?.batteryVoltage).toBeCloseTo(3.95, 2);
  });

  it('decodes a west/south coordinate from the sign (decimal degrees)', () => {
    const frame = meitrackFrame(trackingBody(0, '22.93820', '-113.38270'));
    const r = new ByteReader();
    r.append(frame);
    const raw = unwrap(adapter.frame(r, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.position?.longitude).toBeCloseTo(-113.3827, 4);
  });

  it('decodes an ALARM (event 1 SOS) with mapped severity + position', () => {
    const frame = meitrackFrame(trackingBody(1));
    const r = new ByteReader();
    r.append(frame);
    const raw = unwrap(adapter.frame(r, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('ALARM');
    expect(msg.alarms?.[0]?.code).toBe('SOS');
    expect(msg.alarms?.[0]?.severity).toBe('CRITICAL');
    expect(msg.alarms?.[0]?.source).toBe('1');
    expect(msg.position).toBeDefined();
  });

  it('maps a power-cut event to CRITICAL and an unknown event to a generic label', () => {
    const cut = meitrackFrame(trackingBody(23));
    const unknown = meitrackFrame(trackingBody(250));
    const mk = (f: Buffer) => {
      const r = new ByteReader();
      r.append(f);
      const msg = adapter.decode(unwrap(adapter.frame(r, NOW)))[0];
      if (!msg) throw new Error('decode produced no message');
      return msg;
    };
    const cutMsg = mk(cut);
    const unkMsg = mk(unknown);
    expect(cutMsg.type).toBe('ALARM');
    expect(cutMsg.alarms?.[0]?.code).toBe('POWER_CUT');
    expect(cutMsg.alarms?.[0]?.severity).toBe('CRITICAL');
    expect(unkMsg.alarms?.[0]?.code).toBe('EVENT_250');
    expect(unkMsg.alarms?.[0]?.severity).toBe('INFO');
  });

  it('decodes a command response (D82) as COMMAND_ACK', () => {
    const frame = meitrackFrame(`${IMEI},D82,A11,OK`);
    const r = new ByteReader();
    r.append(frame);
    const raw = unwrap(adapter.frame(r, NOW));
    const msg = adapter.decode(raw)[0];
    if (!msg) throw new Error('decode produced no message');
    expect(msg.type).toBe('COMMAND_ACK');
    expect(msg.telemetry?.command).toBe('D82');
    expect(msg.telemetry?.response).toBe('A11,OK');
  });

  it('throws ProtocolError on an unsupported command', () => {
    const frame = meitrackFrame(`${IMEI},ZZZ,foo`);
    const r = new ByteReader();
    r.append(frame);
    const raw = unwrap(adapter.frame(r, NOW));
    expect(() => adapter.decode(raw)).toThrow(/not supported/);
  });
});

describe('MeitrackAdapter.encode', () => {
  const adapter = new MeitrackAdapter();

  it('encodes a LOGIN_ACK as an @@ AAC frame that re-validates under the checksum', () => {
    const buf = adapter.encode({
      deviceId: 'd',
      type: 'LOGIN_ACK',
      payload: { imei: IMEI },
    });
    const text = buf.toString('ascii');
    expect(text.startsWith('@@A')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text).toContain(`,${IMEI},AAC*`);
    // Re-validate: checksum region = '@@…*'; trailing 2 hex match.
    const star = text.lastIndexOf('*');
    const region = text.slice(0, star + 1);
    const ck = text.slice(star + 1, star + 3);
    expect(meitrackChecksum(Buffer.from(region, 'ascii'))).toBe(ck);
  });

  it('encodes a heartbeat-interval config command (A11) with the interval arg', () => {
    const buf = adapter.encode({
      deviceId: 'd',
      type: 'TELEMETRY',
      payload: { imei: IMEI, command: 'A11', intervalSeconds: 30 },
    });
    const text = buf.toString('ascii');
    expect(text).toContain(`${IMEI},A11,30`);
    expect(text.startsWith('@@A')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('returns an empty buffer when the command has no IMEI', () => {
    const buf = adapter.encode({ deviceId: '', type: 'LOGIN_ACK', payload: {} });
    expect(buf.length).toBe(0);
  });
});

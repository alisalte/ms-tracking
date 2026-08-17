import { describe, expect, it } from '@jest/globals';
import {
  buildMeitrackBinaryFrame,
  buildMeitrackFrame,
  encodeMeitrack,
} from '../infrastructure/adapters/meitrack/meitrack.encode.js';
import { meitrackChecksum } from '../infrastructure/adapters/meitrack/meitrack.frames.js';
import { MeitrackAdapter } from '../infrastructure/adapters/meitrack/meitrack.adapter.js';
import { ByteReader, NEED_MORE } from '../infrastructure/transport/byte-reader.js';
import { RawPacket } from '../domain/index.js';

const IMEI = '866854036516451';
const adapter = new MeitrackAdapter();

/** Build + frame a device→server $$… packet (mirrors meitrack.spec helper). */
function deviceFrame(content: string): RawPacket {
  const commaBlock = `,${content}`;
  const length = commaBlock.length + 1 + 2 + 2;
  const head = `$$A${String(length).padStart(4, '0')}`;
  const region = `${head}${commaBlock}*`;
  const cc = meitrackChecksum(Buffer.from(region, 'ascii'));
  const reader = new ByteReader();
  reader.append(Buffer.from(`${region}${cc}\r\n`, 'ascii'));
  const raw = adapter.frame(reader, new Date());
  if (raw === NEED_MORE) throw new Error('NEED_MORE — frame incomplete');
  return raw;
}

/**
 * Downstream command encoding for the MDVR command surface: ASCII frames and
 * binary-bodied media frames (§4.1/§4.2 examples).
 */
describe('meitrack downstream command encoding', () => {
  it('builds an ASCII frame whose length + checksum re-validate', () => {
    const frame = buildMeitrackFrame(`${IMEI},A12,6`);
    const text = frame.toString('ascii');
    expect(text.startsWith('@@A')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    // Length field counts from the first comma through \r\n inclusive.
    const commaIndex = text.indexOf(',');
    const length = Number.parseInt(text.slice(3, commaIndex), 10);
    expect(length).toBe(frame.length - commaIndex);
    // Checksum = byte sum from @@ through * (inclusive).
    const star = text.lastIndexOf('*');
    expect(meitrackChecksum(frame.subarray(0, star + 1))).toBe(text.slice(star + 1, star + 3));
  });

  it('builds a binary-bodied frame with byte-wise checksum (§4.2 A9B example)', () => {
    const body = Buffer.concat([
      Buffer.from('A9B,', 'ascii'),
      Buffer.from([0x01, 0x01, 0x00, 0x00]),
    ]);
    const frame = buildMeitrackBinaryFrame(`${IMEI},`, body);
    // Re-parse: length + checksum must hold over the raw bytes.
    const text = frame.toString('binary');
    const commaIndex = 4; // '@','@','A',<len digits>… find real comma:
    const comma = frame.indexOf(0x2c);
    expect(comma).toBeGreaterThan(3);
    const length = Number.parseInt(frame.toString('ascii', 3, comma), 10);
    expect(length).toBe(frame.length - comma);
    const star = frame.lastIndexOf(0x2a);
    expect(meitrackChecksum(frame.subarray(0, star + 1))).toBe(
      frame.toString('ascii', star + 1, star + 3),
    );
    // Body bytes survive verbatim.
    expect(frame.subarray(comma + 1 + IMEI.length + 1, star).toString('hex')).toBe(
      '4139422c01010000',
    );
    expect(commaIndex).toBe(4);
    void text;
  });

  it('encodeMeitrack routes hex payloads to the binary frame', () => {
    const frame = encodeMeitrack({
      deviceId: 'dev-uuid',
      type: 'COMMAND',
      payload: { imei: IMEI, hex: '4139422C01010000' },
    });
    expect(frame.length).toBeGreaterThan(0);
    expect(frame.toString('ascii').startsWith('@@A')).toBe(true);
    // The binary body is embedded after <imei>, and the checksum covers it.
    const comma = frame.indexOf(0x2c);
    const star = frame.lastIndexOf(0x2a);
    expect(frame.subarray(comma + 1 + IMEI.length + 1, star).toString('hex')).toBe(
      '4139422c01010000',
    );
  });

  it('encodeMeitrack routes text payloads through the generic passthrough', () => {
    const frame = encodeMeitrack({
      deviceId: 'dev-uuid',
      type: 'COMMAND',
      payload: { imei: IMEI, text: 'B05,1,22.913191,114.079882,1000,0,1' },
    });
    expect(frame.toString('ascii')).toContain(`${IMEI},B05,1,22.913191,114.079882,1000,0,1`);
  });

  it('returns an empty buffer for invalid hex', () => {
    const frame = encodeMeitrack({
      deviceId: 'dev-uuid',
      type: 'COMMAND',
      payload: { imei: IMEI, hex: 'zz-not-hex' },
    });
    expect(frame.length).toBe(0);
  });
});

describe('meitrack device command-response decoding (MDVR §3.x echo replies)', () => {
  it('decodes an echoed-code OK reply (A11) as COMMAND_ACK', () => {
    const msgs = adapter.decode(deviceFrame(`${IMEI},A11,OK`));
    expect(msgs).toHaveLength(1);
    const msg = msgs[0];
    if (!msg) throw new Error('no message');
    expect(msg.type).toBe('COMMAND_ACK');
    expect(msg.telemetry?.command).toBe('A11');
    expect(msg.telemetry?.response).toBe('OK');
  });

  it('decodes echoed replies carrying data (E91 version)', () => {
    const msgs = adapter.decode(deviceFrame(`${IMEI},E91,MD522S_G4PGW1_H100V44.27412345678`));
    const msg = msgs[0];
    if (!msg) throw new Error('no message');
    expect(msg.type).toBe('COMMAND_ACK');
    expect(msg.telemetry?.command).toBe('E91');
    expect(msg.telemetry?.response).toContain('MD522S');
  });

  it('still decodes the D82 wrapper shape', () => {
    const msgs = adapter.decode(deviceFrame(`${IMEI},D82,A11,OK`));
    const msg = msgs[0];
    if (!msg) throw new Error('no message');
    expect(msg.type).toBe('COMMAND_ACK');
    expect(msg.telemetry?.command).toBe('D82');
    expect(msg.telemetry?.response).toBe('A11,OK');
  });
});

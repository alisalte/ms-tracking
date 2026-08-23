import { describe, expect, it } from '@jest/globals';
import {
  buildGprsCommand,
  buildGprsReply,
  decodeA9aStruct,
  gprsChecksum,
  parseGprsFrame,
} from '../gprs-frame.js';

describe('gprsChecksum', () => {
  it('computes the modular byte sum (mod 256) as documented', () => {
    expect(gprsChecksum(Buffer.from('$$A10,867191086416152,AAA*', 'ascii'))).toBeGreaterThan(0);
    // Sum wraps mod 256.
    expect(gprsChecksum(Buffer.alloc(256, 1))).toBe(0);
    expect(gprsChecksum(Buffer.alloc(257, 1))).toBe(1);
  });
});

describe('buildGprsCommand / parseGprsFrame round-trip', () => {
  it('round-trips a text command with content', () => {
    const frame = buildGprsCommand('867191086416152', 'A11', '10', 'A');
    const res = parseGprsFrame(frame);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.direction).toBe('command');
    expect(res.imei).toBe('867191086416152');
    expect(res.commandCode).toBe('A11');
    expect(res.content).toBe('10');
    expect(res.validChecksum).toBe(true);
    expect(res.consumed).toBe(frame.length);
  });

  it('round-trips a device reply ($$) frame', () => {
    const frame = buildGprsReply('867191086416152', 'A9A', 'OK');
    const res = parseGprsFrame(frame);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.direction).toBe('reply');
    expect(res.commandCode).toBe('A9A');
    expect(res.content).toBe('OK');
    expect(res.validChecksum).toBe(true);
  });

  it('detects a corrupted checksum', () => {
    const frame = buildGprsReply('867191086416152', 'D82', 'A11,OK');
    const idx = frame.length - 3;
    frame[idx] = (frame[idx] ?? 0) ^ 0x01; // flip a checksum nibble
    const res = parseGprsFrame(frame);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.validChecksum).toBe(false);
  });

  it('rejects non-frame data and reports incomplete frames', () => {
    expect(parseGprsFrame(Buffer.from('hello world 1234'))).toEqual({ status: 'invalid' });
    const partial = buildGprsCommand('867191086416152', 'A10', '0').subarray(0, 8);
    const res = parseGprsFrame(partial);
    expect(res.status).toBe('incomplete');
  });

  it('length field counts from the first comma through \\r\\n (spec arithmetic)', () => {
    const frame = buildGprsCommand('123456789012345', 'A10', '0');
    const res = parseGprsFrame(frame);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    // consumed = flag(2) + dataId(1) + lenDigits + length.
    const lenDigits = String(res.length).length;
    expect(res.consumed).toBe(2 + 1 + lenDigits + res.length);
  });
});

describe('decodeA9aStruct', () => {
  it('decodes the §3.16 struct (ip_len + ip + ports + channel + types)', () => {
    const ip = '178.131.31.231';
    const body = Buffer.concat([
      Buffer.from([ip.length]),
      Buffer.from(ip, 'ascii'),
      (() => {
        const b = Buffer.alloc(7);
        b.writeUInt16BE(6182, 0);
        b.writeUInt16BE(0, 2);
        b[4] = 1; // channel
        b[5] = 1; // dataType: video
        b[6] = 1; // streamType: minor
        return b;
      })(),
    ]);
    const a9a = decodeA9aStruct(body);
    expect(a9a).toEqual({
      server: ip,
      tcpPort: 6182,
      udpPort: 0,
      channel: 1,
      dataType: 1,
      streamType: 1,
    });
  });

  it('returns null for truncated bodies', () => {
    expect(decodeA9aStruct(Buffer.alloc(0))).toBeNull();
    expect(decodeA9aStruct(Buffer.from([4, 1, 2, 3, 4]))).toBeNull();
  });
});

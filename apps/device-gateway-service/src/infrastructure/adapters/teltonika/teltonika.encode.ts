/**
 * Teltonika encode — server → device frames.
 *
 *   LOGIN_ACK   → 0x01 (IMEI accepted; the device then starts sending AVL data)
 *   LOGIN_NACK  → 0x00 (IMEI refused; the device closes and retries later)
 *   AVL_ACK     → u32 record count — tells the device those records are stored
 *   anything with `payload.text` → Codec 12 text command (e.g. `getinfo`)
 *
 * Returns an empty Buffer for anything it cannot encode (the dispatcher rejects
 * writing an empty frame).
 */
import type { DeviceCommand } from '../../protocol/protocol-adapter.js';
import { TELTONIKA_CODEC, teltonikaCrc16 } from './teltonika.frames.js';

export function encodeTeltonika(cmd: DeviceCommand): Buffer {
  switch (cmd.type) {
    case 'LOGIN_ACK':
      return Buffer.from([0x01]);
    case 'LOGIN_NACK':
      return Buffer.from([0x00]);
    case 'AVL_ACK': {
      const count = Number(cmd.payload.count ?? 0);
      const out = Buffer.alloc(4);
      out.writeUInt32BE(Math.max(0, Math.trunc(count)), 0);
      return out;
    }
    default: {
      const text = typeof cmd.payload.text === 'string' ? cmd.payload.text : '';
      return text ? encodeCodec12Command(text) : Buffer.alloc(0);
    }
  }
}

/** Codec 12 command: 00000000 · len · 0C 01 05 size text 01 · CRC-16/IBM. */
export function encodeCodec12Command(text: string): Buffer {
  const body = Buffer.from(text, 'ascii');
  const data = Buffer.concat([
    Buffer.from([TELTONIKA_CODEC.CODEC_12, 0x01, 0x05]),
    u32(body.length),
    body,
    Buffer.from([0x01]),
  ]);
  return Buffer.concat([u32(0), u32(data.length), data, u32(teltonikaCrc16(data))]);
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/**
 * JT808 framing + escape (byte-stuffing) + BCC checksum
 * (06 §2.1; JT/T 808-2019 §"消息结构" / "转义").
 *
 * JT/T 808 (Chinese national commercial-vehicle protocol) frames are delimited
 * by 0x7e and use 0x7d byte-stuffing on everything *between* the delimiters:
 *
 *   ┌──────┬──────────────────────────────────────────────────────┬──────┐
 *   │ 0x7e │ msgId(2) bodyProps(2) [ver(1)] phone(BCD 6|10)        │ 0x7e │
 *   │ flag │ msgSn(2) [fragTotal(2) fragSn(2)] body cksum(1)      │ flag │
 *   └──────┴──────────────────────────────────────────────────────┴──────┘
 *
 * Escape rules (applied to header+body+checksum, never the delimiters):
 *   0x7e  →  0x7d 0x02     (so the delimiter can never appear mid-frame)
 *   0x7d  →  0x7d 0x01
 *
 * Checksum: single-byte BCC = XOR of all bytes from msgId through the last body
 * byte (i.e. everything between the delimiters except the checksum byte itself).
 *
 * Frame length is the inter-delimiter span — there is no external length field
 * (the bodyProps low-10-bit length only describes the body portion). The framer
 * therefore scans for the trailing 0x7e, then unstuffs what lies between.
 */
import { ProtocolError } from '../../../domain/errors.js';
import { RawPacket } from '../../../domain/raw-packet.js';
import { type ByteReader, NEED_MORE } from '../../transport/byte-reader.js';

/** Frame delimiter. */
export const JT808_FLAG = 0x7e;
/** Escape (stuffing) byte. */
export const JT808_ESCAPE = 0x7d;

/** Max frame size guard (06 §3.3 — protects against malicious oversize). */
const MAX_FRAME_BYTES = 64 * 1024;

/**
 * Compute the JT808 BCC checksum: XOR of every byte in `data` (mod 256). Applied
 * over the unstuffed msgId-through-last-body-byte region.
 */
export function jt808Checksum(data: Buffer): number {
  let xor = 0;
  for (let i = 0; i < data.length; i++) {
    xor ^= data[i] ?? 0;
  }
  return xor & 0xff;
}

/**
 * Apply JT808 byte-stuffing (escape) to `data` (header+body+checksum, without the
 * 0x7e delimiters). 0x7e → 0x7d 0x02, 0x7d → 0x7d 0x01. Used by the encoder.
 */
export function escape808(data: Buffer): Buffer {
  const out: number[] = [];
  for (const byte of data) {
    const b = byte ?? 0;
    if (b === JT808_FLAG) {
      out.push(JT808_ESCAPE, 0x02);
    } else if (b === JT808_ESCAPE) {
      out.push(JT808_ESCAPE, 0x01);
    } else {
      out.push(b);
    }
  }
  return Buffer.from(out);
}

/**
 * Reverse JT808 byte-stuffing over the bytes strictly between the 0x7e delimiters.
 * 0x7d 0x01 → 0x7d, 0x7d 0x02 → 0x7e. Throws ProtocolError on a dangling 0x7d.
 */
export function unescape808(data: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const b = data[i] ?? 0;
    if (b === JT808_ESCAPE) {
      const next = data[i + 1];
      if (next === 0x01) {
        out.push(JT808_ESCAPE);
      } else if (next === 0x02) {
        out.push(JT808_FLAG);
      } else {
        throw new ProtocolError(
          `JT808 invalid escape sequence 0x7d 0x${(next ?? 0).toString(16)}.`,
          'jt808',
        );
      }
      i++; // consume the escape follower
    } else {
      out.push(b);
    }
  }
  return Buffer.from(out);
}

/**
 * Frame one JT808 packet from the byte stream. Scans for the leading 0x7e, then
 * for the trailing 0x7e (scanning a bounded window so partial frames don't
 * discard buffered data), unstuffs the bytes between, validates the BCC checksum,
 * and returns the complete frame as a RawPacket (unstuffed, both delimiters
 * included). Returns NEED_MORE when the frame is incomplete.
 */
export function frameJt808(reader: ByteReader, receivedAt: Date): RawPacket | typeof NEED_MORE {
  // Skip leading garbage until we find the flag.
  while (reader.available >= 1) {
    if ((reader.peek(1)[0] ?? 0) === JT808_FLAG) break;
    reader.read(1);
  }
  if (reader.available < 1) return NEED_MORE;

  // Find the trailing flag from the current position. Scan a bounded window so a
  // partial frame doesn't pull the whole queue.
  const scan = reader.peek(Math.min(reader.available, MAX_FRAME_BYTES));
  let endOffset = -1;
  for (let i = 1; i < scan.length; i++) {
    if (scan[i] === JT808_FLAG) {
      endOffset = i;
      break;
    }
  }
  if (endOffset === -1) {
    if (scan.length >= MAX_FRAME_BYTES) {
      reader.read(1);
      throw new ProtocolError('JT808 frame exceeds max size without trailing flag.', 'jt808');
    }
    return NEED_MORE;
  }

  const frameLen = endOffset + 1; // includes both delimiters
  const raw = reader.read(frameLen);
  if (raw === NEED_MORE) return NEED_MORE;

  // Unstuff the bytes strictly between the delimiters.
  const stuffed = raw.subarray(1, frameLen - 1);
  let unstuffed: Buffer;
  try {
    unstuffed = unescape808(stuffed);
  } catch (err) {
    if (err instanceof ProtocolError) throw err;
    throw new ProtocolError(`JT808 unescape failed: ${(err as Error).message}.`, 'jt808');
  }

  // Minimum: msgId(2) + bodyProps(2) + phone(6) + msgSn(2) + cksum(1) = 13 bytes.
  if (unstuffed.length < 13) {
    throw new ProtocolError(
      `JT808 frame too short (${unstuffed.length} unstuffed bytes).`,
      'jt808',
    );
  }

  // Checksum region = everything except the final checksum byte; compare to it.
  const checksumRegion = unstuffed.subarray(0, unstuffed.length - 1);
  const expectedChecksum = jt808Checksum(checksumRegion);
  const receivedChecksum = unstuffed[unstuffed.length - 1] ?? 0;
  if (receivedChecksum !== expectedChecksum) {
    throw new ProtocolError(
      `JT808 BCC mismatch: got 0x${receivedChecksum.toString(16)}, expected 0x${expectedChecksum.toString(16)}.`,
      'jt808',
    );
  }

  // Re-wrap the unstuffed content with both delimiters so decode sees the clean
  // frame and can re-slice the header deterministically.
  const payload = Buffer.concat([Buffer.from([JT808_FLAG]), unstuffed, Buffer.from([JT808_FLAG])]);

  return new RawPacket({
    protocolId: 'jt808',
    payload,
    receivedAt,
    direction: 'INBOUND',
  });
}

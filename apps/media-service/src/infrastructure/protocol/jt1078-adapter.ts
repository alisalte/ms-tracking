/**
 * JT1078 protocol adapter — frame parser for the JT/T 1078 media protocol
 * (09 §3.5; 06 §2.1).
 *
 * JT1078 is the companion media plane to JT808. The device-gateway's JT808
 * control channel issues `0x9101` (start realtime AV), and the DVR then pushes
 * RTP-over-TCP JT1078 frames to the media-router. This adapter parses those
 * frames into the canonical MediaFrame shape.
 *
 * Frame layout (after the leading 0x30 0x31 start mark):
 *   length(2) seq(2) BCD-SIM(6) logicalChannel(1) alarmFlag(4) sampleCount(1)
 *   BCD-timestamp(8, Beijing→UTC) lastFrameFlag(1) dataType(1) streamType(1)
 *   body...
 *
 * Stream types: 98=H.264, 99=H.265, 100=AAC, 106=G.711, 107=G.726.
 *
 * Sprint 10: the adapter PARSES frames (the hard part — BCD decode, timestamp
 * normalization, stream-type mapping). It does NOT own the TCP listener — that's
 * the media-router's responsibility. Exercised in tests with raw frame buffers.
 */
import type { MediaFrame, SourceMeta, StreamType } from '../../domain/media-frame.js';
import { decodeStreamType } from '../../domain/media-frame.js';

/** JT1078 start mark (0x30 0x31 = ASCII "01"). */
export const JT1078_START = [0x30, 0x31] as const;

/** Fixed header size after the start mark (up to the body). */
const HEADER_SIZE = 28; // length(2) + seq(2) + sim(6) + channel(1) + alarm(4) + sample(1) + ts(8) + last(1) + dataType(1) + streamType(1) +1(payloadLen 4)

/** Parsed JT1078 header fields. */
export interface Jt1078Header {
  readonly length: number;
  readonly seq: number;
  readonly sim: string; // BCD SIM (12 hex digits)
  readonly logicalChannel: number;
  readonly alarmFlag: number;
  readonly sampleCount: number;
  /** Capture time in UTC (normalized from Beijing BCD). */
  readonly timestamp: Date;
  readonly lastFrame: boolean;
  readonly dataType: number; // 0=video, 1=audio
  readonly streamType: StreamType | null;
  readonly bodyOffset: number;
  readonly bodyLength: number;
}

/**
 * Parse the JT1078 header from a raw frame buffer (starting at 0x30 0x31).
 * Throws on a truncated/malformed frame.
 */
export function parseJt1078Header(buf: Buffer): Jt1078Header {
  if (buf.length < HEADER_SIZE + 2) {
    throw new Error(`JT1078 frame too short (${buf.length} bytes, need ≥ ${HEADER_SIZE + 2}).`);
  }
  // Skip the 0x30 0x31 start mark.
  let off = 2;
  const length = buf.readUInt16BE(off); off += 2;
  const seq = buf.readUInt16BE(off); off += 2;
  const sim = bcdHex(buf.subarray(off, off + 6)); off += 6;
  const logicalChannel = buf[off] ?? 0; off += 1;
  const alarmFlag = buf.readUInt32BE(off); off += 4;
  const sampleCount = buf[off] ?? 0; off += 1;
  const timestamp = readBcdTimestamp(buf.subarray(off, off + 8)); off += 8;
  const lastFrame = (buf[off] ?? 0) === 1; off += 1;
  const dataType = buf[off] ?? 0; off += 1;
  const streamTypeByte = buf[off] ?? 0; off += 1;

  const streamType = decodeStreamType(streamTypeByte);
  const bodyOffset = off;
  // length field includes everything from the seq through the body, excluding
  // the start mark and the length field itself. body = total - headerConsumed.
  const headerConsumed = off - 2; // bytes consumed after the start mark
  const bodyLength = Math.max(0, length - headerConsumed + 2);

  return {
    length, seq, sim, logicalChannel, alarmFlag, sampleCount,
    timestamp, lastFrame, dataType, streamType,
    bodyOffset, bodyLength,
  };
}

/**
 * Parse a complete JT1078 frame into a canonical MediaFrame.
 * The `channelId` is assigned by the caller (from the logical channel → channel mapping).
 */
export function parseJt1078Frame(
  buf: Buffer,
  channelId: string,
): MediaFrame {
  const h = parseJt1078Header(buf);
  if (!h.streamType) {
    throw new Error(`JT1078 unsupported stream type ${buf[h.bodyOffset - 1] ?? 0}.`);
  }
  const payload = buf.subarray(h.bodyOffset, h.bodyOffset + h.bodyLength);
  const sourceMeta: SourceMeta = {
    protocol: 'JT1078',
    logicalChannel: h.logicalChannel,
    alarmFlag: h.alarmFlag !== 0,
  };
  const isVideo = h.dataType === 0;
  // Keyframe detection: in H.264/H.265 NALU, type 5 (H264) or 19/20 (H265) is an IDR.
  // For Sprint 10 we approximate: the first byte of the NALU's type nibble.
  const isKeyframe = isVideo ? isIdrNalu(payload, h.streamType) : false;

  return {
    channelId,
    streamType: h.streamType,
    kind: isVideo ? 'video' : 'audio',
    payload,
    isKeyframe,
    timestamp: h.seq,
    wallClock: h.timestamp,
    sourceMeta,
    seq: h.seq,
  };
}

/**
 * Read the 8-byte BCD timestamp (Beijing time: YYMMDDhhmmssms¹ms²) → UTC Date.
 * The JT1078 timestamp is in Beijing time (UTC+8) and must be normalized to UTC.
 * Layout: year(1) month(1) day(1) hour(1) minute(1) second(1) ms-tens(1) ms-units(1).
 */
function readBcdTimestamp(buf: Buffer): Date {
  const yy = bcd(buf[0]);
  const mm = bcd(buf[1]);
  const dd = bcd(buf[2]);
  const hh = bcd(buf[3]);
  const mi = bcd(buf[4]);
  const ss = bcd(buf[5]);
  // ms = tens * 100 + units (BCD hundredths → milliseconds approximation)
  const msTens = bcd(buf[6]);
  const msUnits = bcd(buf[7]);
  const ms = msTens * 10 + msUnits;

  // Interpret as Beijing (UTC+8) → convert to UTC.
  const beijingDate = new Date(Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss, ms));
  // Subtract 8 hours to get UTC.
  return new Date(beijingDate.getTime() - 8 * 3600 * 1000);
}

/** Decode a BCD byte to its decimal value (e.g. 0x23 → 23). */
function bcd(byte: number | undefined): number {
  const b = byte ?? 0;
  return ((b >> 4) & 0x0f) * 10 + (b & 0x0f);
}

/** Render a BCD byte buffer as a hex string (for SIM). */
function bcdHex(buf: Buffer): string {
  let s = '';
  for (const b of buf) {
    s += ((b ?? 0) >>> 4).toString(16);
    s += ((b ?? 0) & 0x0f).toString(16);
  }
  return s;
}

/** Heuristic IDR detection for H.264/H.265 NALU (first-byte type). */
function isIdrNalu(payload: Buffer, codec: StreamType): boolean {
  if (payload.length < 1) return false;
  const nalType = payload[0] ?? 0;
  if (codec === 'H264') {
    return (nalType & 0x1f) === 5; // IDR slice
  }
  if (codec === 'H265') {
    return (nalType >> 1) === 19 || (nalType >> 1) === 20; // IDR_W_RADL / IDR_N_LP
  }
  return false;
}

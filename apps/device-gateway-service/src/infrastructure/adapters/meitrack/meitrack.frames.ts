/**
 * Meitrack framing + checksum (06 §2.1; Meitrack GPRS Protocol v1.6).
 *
 * Meitrack (Taiwan — MVT380, MT90, P99B, T622…) speaks a mixed text/binary
 * protocol. The frame layout:
 *
 *   ┌──────┬──────────┬───────────┬───────────────────────┬──────┬─────────┬──────┐
 *   │Flag  │Data ID   │Data Length│ Content (comma fields)│ Stop │Checksum │End   │
 *   │$$|@@ │ 1 char   │ dddd dec  │ ,<imei>,<cmd>,...     │  *   │ 2 hex   │\r\n  │
 *   └──────┴──────────┴───────────┴───────────────────────┴──────┴─────────┴──────┘
 *
 *   $$ — device → server start mark (ASCII 0x24 0x24).
 *   @@ — server → device start mark.
 *   Data ID — single ASCII char 0x41..0x7A; identifies the packet family
 *             (e.g. 'A' for the AAA tracking family used here).
 *   Data Length — decimal ASCII digits up to the first comma. Per the spec it is
 *             the number of characters from the first comma through the \r\n
 *             (inclusive). Total frame length therefore = commaIndex + length,
 *             which is exactly the arithmetic the reference Traccar decoder uses
 *             (`index - readerIndex + parseInt(digits)`).
 *   Checksum — modular sum of all ASCII bytes from the flag through the '*'
 *             (inclusive), mod 256, formatted as 2 uppercase hex digits. (Despite
 *             the spec table's generic "CRC" label, the classic ASCII protocol is a
 *             byte sum — this is what real devices verify, so we implement it.)
 *
 * Detection (06 §2.3): a frame starts with "$$".
 */
import { ProtocolError } from '../../../domain/errors.js';
import { RawPacket } from '../../../domain/raw-packet.js';
import { type ByteReader, NEED_MORE } from '../../transport/byte-reader.js';

/** Packet-family data IDs (the single char after the flag). */
export const MEITRACK_DATA_ID = {
  /** Tracking / event / command-response family (AAA, AAC, D82…). */
  TRACKING: 'A',
} as const;

/** Frame markers. */
export const MEITRACK_FLAG_IN = Buffer.from('$$', 'ascii'); // device → server
export const MEITRACK_FLAG_OUT = '@@'; // server → device (text only; encode builds it)
export const MEITRACK_STOP = Buffer.from([0x0d, 0x0a]); // \r\n
/** The '*' separator that prefixes the trailing checksum. */
export const MEITRACK_CHECKSUM_SEP = 0x2a;

/**
 * Command codes found in the 3-char command field of the tracking family
 * (Meitrack GPRS Protocol v1.6). We decode the subset needed end-to-end; others
 * are rejected with ProtocolError so the dispatcher bumps `decode.error`.
 */
export const MEITRACK_COMMAND = {
  /** Tracking data packet (GPS + event). The workhorse device packet. */
  TRACKING: 'AAA',
  /** Server → device: command-acknowledgement response. */
  ACK: 'AAC',
  /** Device → server: command result / response payload. */
  COMMAND_RESPONSE: 'D82',
} as const;

/** Max frame size guard (06 §3.3 — protects against malicious oversize). */
const MAX_FRAME_BYTES = 64 * 1024;

/**
 * Compute the Meitrack checksum over `data` (ASCII bytes from the flag through
 * the '*' inclusive): modular byte sum mod 256, rendered as 2 uppercase hex.
 */
export function meitrackChecksum(data: Buffer): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum = (sum + (data[i] ?? 0)) & 0xff;
  }
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Frame one Meitrack packet from the byte stream. Scans for the `$$` flag, then
 * reads the decimal length up to the first comma, validates that
 * `commaIndex + length` bytes (including the trailing `*<cc>\r\n`) are present,
 * verifies the checksum, and returns the complete frame as a RawPacket
 * (markers included). Returns NEED_MORE when the frame is incomplete.
 */
export function frameMeitrack(reader: ByteReader, receivedAt: Date): RawPacket | typeof NEED_MORE {
  // Skip leading garbage until we find the $$ flag.
  while (reader.available >= MEITRACK_FLAG_IN.length) {
    const head = reader.peek(2);
    if (head[0] === MEITRACK_FLAG_IN[0] && head[1] === MEITRACK_FLAG_IN[1]) break;
    reader.read(1); // discard one byte and rescan
  }
  if (reader.available < MEITRACK_FLAG_IN.length) return NEED_MORE;

  // We need at least flag(2) + dataId(1) + length(1) + comma(1) ... to locate the
  // length field. Find the first comma; everything between offset 3 (flag+dataId)
  // and the comma is the decimal length.
  const scan = reader.peek(Math.min(reader.available, MAX_FRAME_BYTES));
  let commaOffset = -1;
  for (let i = 3; i < scan.length; i++) {
    if (scan[i] === 0x2c) {
      commaOffset = i;
      break;
    }
  }
  if (commaOffset === -1) {
    if (scan.length >= MAX_FRAME_BYTES) {
      reader.read(MEITRACK_FLAG_IN.length);
      throw new ProtocolError('Meitrack frame exceeds max size without comma.', 'meitrack');
    }
    return NEED_MORE;
  }

  // Parse the decimal length (ASCII digits between offset 3 and the comma).
  const lengthDigits = scan.subarray(3, commaOffset).toString('ascii');
  if (!/^\d+$/.test(lengthDigits)) {
    // Garbage where a length was expected — resync past the flag.
    reader.read(MEITRACK_FLAG_IN.length);
    throw new ProtocolError(`Meitrack length field is non-numeric: '${lengthDigits}'.`, 'meitrack');
  }
  const length = Number.parseInt(lengthDigits, 10);

  // Total frame length = commaOffset + length (length counts from the first comma
  // through \r\n inclusive — the reference decoder's arithmetic).
  const frameLen = commaOffset + length;
  if (frameLen > MAX_FRAME_BYTES) {
    reader.read(MEITRACK_FLAG_IN.length);
    throw new ProtocolError('Meitrack frame exceeds max size.', 'meitrack');
  }
  if (reader.available < frameLen) return NEED_MORE;

  const frame = reader.read(frameLen);
  if (frame === NEED_MORE) return NEED_MORE;

  // Structural tail check: ...*<cc>\r\n.
  if (
    frame[frameLen - 1] !== MEITRACK_STOP[1] ||
    frame[frameLen - 2] !== MEITRACK_STOP[0] ||
    frame[frameLen - 5] !== MEITRACK_CHECKSUM_SEP
  ) {
    throw new ProtocolError(
      'Meitrack frame has malformed tail (expected *<cc>\\r\\n).',
      'meitrack',
    );
  }

  // Checksum region = flag through '*' inclusive = frame[0 .. frameLen-4).
  const checksumRegion = frame.subarray(0, frameLen - 4);
  const expectedChecksum = meitrackChecksum(checksumRegion);
  const receivedChecksum = frame.subarray(frameLen - 4, frameLen - 2).toString('ascii');
  if (receivedChecksum !== expectedChecksum) {
    throw new ProtocolError(
      `Meitrack checksum mismatch: got ${receivedChecksum}, expected ${expectedChecksum}.`,
      'meitrack',
    );
  }

  return new RawPacket({
    protocolId: 'meitrack',
    payload: Buffer.from(frame),
    receivedAt,
    direction: 'INBOUND',
  });
}

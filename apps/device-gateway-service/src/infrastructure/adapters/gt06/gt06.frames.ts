/**
 * GT06 framing + CRC (06 §2.1).
 *
 * GT06 / Concox family frame layout (the most-cloned commodity-tracker protocol):
 *
 *   ┌────────┬────────┬───────────────────────┬──────────┬────────┬────────┐
 *   │ Start  │ Proto  │ Data (incl. info ser.)│ Info ser.│ CRC-16 │ Stop   │
 *   │ 78 78  │ 1 B    │ 0..N                  │ 2 B      │ 2 B    │ 0D 0A  │
 *   └────────┴────────┴───────────────────────┴──────────┴────────┴────────┘
 *
 * The "Information Serial Number" (2 B) precedes the CRC and is echoed in acks.
 * The CRC covers everything from the protocol-number byte through the info-serial.
 * There is no explicit length field — the frame is delimited by the start/stop
 * markers, and the data length is implied by the protocol-number-specific layout.
 * For the generic gateway framing layer we read forward until we find the stop
 * markers (0x0D 0x0A) and validate the trailing CRC; protocol-number-specific
 * decoding happens in `decode.ts`.
 *
 * Start variants: 0x78 0x78 (most models) and 0x79 0x79 (extended-length, rare).
 * We support 0x78 0x78 (the common case); 0x79 0x79 is a later-sprint extension.
 */
import { ProtocolError } from '../../../domain/errors.js';
import { RawPacket } from '../../../domain/raw-packet.js';
import { type ByteReader, NEED_MORE } from '../../transport/byte-reader.js';

/** GT06 protocol (message) numbers we understand (subset). */
export const GT06_PROTOCOL = {
  LOGIN: 0x01,
  GPS: 0x10,
  LBS: 0x22,
  STATUS: 0x13,
  HEARTBEAT: 0x1a,
  ALARM: 0x05,
  COMMAND_ACK: 0x15,
} as const;
export type Gt06ProtocolNumber = (typeof GT06_PROTOCOL)[keyof typeof GT06_PROTOCOL];

export const GT06_START = Buffer.from([0x78, 0x78]);
export const GT06_STOP = Buffer.from([0x0d, 0x0a]);

/** Max frame size guard (06 §3.3 — protects against malicious oversize). */
const MAX_FRAME_BYTES = 64 * 1024;

/**
 * Compute the GT06 CRC-16 (CRC-ITU, polynomial 0x1021, init 0x0000, no
 * reflection/final-xor). Applied over the bytes from the protocol number through
 * the information serial number (inclusive).
 */
export function gt06Crc16(data: Buffer): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i] ?? 0;
    crc ^= byte << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/**
 * Frame one GT06 packet from the byte stream. Scans for the start marker, then
 * reads until the stop marker (0x0D 0x0A), validates the CRC, and returns the
 * complete frame as a RawPacket (delimiters included). Returns NEED_MORE when
 * the frame is incomplete.
 */
export function frameGt06(reader: ByteReader, receivedAt: Date): RawPacket | typeof NEED_MORE {
  // Skip leading garbage until we find the start marker.
  while (reader.available >= GT06_START.length) {
    const head = reader.peek(2);
    if (head[0] === GT06_START[0] && head[1] === GT06_START[1]) break;
    reader.read(1); // discard one byte and rescan
  }
  if (reader.available < GT06_START.length) return NEED_MORE;

  // Find the stop marker from the current position. We scan a window rather than
  // reading the whole queue so partial frames don't discard buffered data.
  let stopOffset = -1;
  const scan = reader.peek(Math.min(reader.available, MAX_FRAME_BYTES));
  for (let i = 2; i < scan.length - 1; i++) {
    if (scan[i] === GT06_STOP[0] && scan[i + 1] === GT06_STOP[1]) {
      stopOffset = i;
      break;
    }
  }
  if (stopOffset === -1) {
    if (scan.length >= MAX_FRAME_BYTES) {
      // Oversize without a stop marker — protocol error; drop the start bytes.
      reader.read(GT06_START.length);
      throw new ProtocolError('GT06 frame exceeds max size without stop marker.', 'gt06');
    }
    return NEED_MORE;
  }

  const frameLen = stopOffset + GT06_STOP.length; // includes start + stop
  const frame = reader.read(frameLen);
  if (frame === NEED_MORE) return NEED_MORE;

  // Validate CRC over [protocolNumber .. informationSerial]. Layout:
  //   start(2) protocol(1) data.. infoSerial(2) crc(2) stop(2)
  // CRC region = frame[2 .. frameLen-4)  (excludes start(2) + crc(2) + stop(2)).
  const crcRegion = frame.subarray(2, frameLen - 4);
  const expectedCrc = gt06Crc16(crcRegion);
  const receivedCrcHi = frame[frameLen - 4] ?? 0;
  const receivedCrcLo = frame[frameLen - 3] ?? 0;
  const receivedCrc = ((receivedCrcHi << 8) | receivedCrcLo) & 0xffff;
  if (receivedCrc !== expectedCrc) {
    throw new ProtocolError(
      `GT06 CRC mismatch: got 0x${receivedCrc.toString(16)}, expected 0x${expectedCrc.toString(16)}.`,
      'gt06',
    );
  }

  return new RawPacket({
    protocolId: 'gt06',
    payload: Buffer.from(frame),
    receivedAt,
    direction: 'INBOUND',
  });
}

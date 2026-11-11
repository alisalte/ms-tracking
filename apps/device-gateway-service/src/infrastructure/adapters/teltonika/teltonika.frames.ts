/**
 * Teltonika framing + CRC (Teltonika Data Sending Protocols, TCP).
 *
 * A Teltonika TCP connection carries two kinds of frame, told apart by their head:
 *
 *   IMEI login (device → server, once per connection)
 *   ┌───────────────┬──────────────────────┐
 *   │ length  2 B   │ IMEI, ASCII digits   │   00 0F + 15 digits
 *   └───────────────┴──────────────────────┘
 *   server answers 0x01 (accept) or 0x00 (reject).
 *
 *   AVL data packet (device → server)
 *   ┌──────────┬───────────┬──────────────────────────────┬──────────┐
 *   │ 00000000 │ length 4B │ codec id, n, records.., n    │ CRC-16 4B│
 *   └──────────┴───────────┴──────────────────────────────┴──────────┘
 *   `length` counts only the data field; the CRC (CRC-16/IBM, upper two bytes
 *   zero) covers the data field. Server answers with the 4-byte record count it
 *   stored — unacknowledged records stay in the device's flash and are resent.
 *
 * The IMEI frame starts with a non-zero length, the AVL frame with four zero
 * bytes, so one stateless parser handles both. A lone 0xFF byte is the
 * device's TCP ping and is discarded.
 */
import { ProtocolError } from '../../../domain/errors.js';
import { RawPacket } from '../../../domain/raw-packet.js';
import { type ByteReader, NEED_MORE } from '../../transport/byte-reader.js';

/** Codec ids an FMB640 can send (Codec 12 carries command responses). */
export const TELTONIKA_CODEC = {
  CODEC_8: 0x08,
  CODEC_8_EXT: 0x8e,
  CODEC_16: 0x10,
  CODEC_12: 0x0c,
} as const;

/** Preamble (4) + data length (4). */
export const AVL_HEADER_BYTES = 8;
/** CRC trailer. */
export const AVL_CRC_BYTES = 4;
/** An IMEI is always 15 digits. */
export const IMEI_LENGTH = 15;

/** Data-field size guard (the FMB640 caps a packet near 1.3 KB; this is generous). */
const MAX_DATA_BYTES = 64 * 1024;
const PING_BYTE = 0xff;

/** CRC-16/IBM (a.k.a. ARC): poly 0xA001 reflected, init 0x0000. */
export function teltonikaCrc16(data: Buffer): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] ?? 0;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

/** True when the payload is an IMEI login frame rather than an AVL packet. */
export function isImeiFrame(payload: Buffer): boolean {
  return payload.length >= 2 && (payload[0] !== 0 || payload[1] !== 0);
}

/**
 * Frame one Teltonika packet from the stream. Returns the complete frame (IMEI
 * or AVL, header and CRC included) or NEED_MORE. A frame that fails its CRC is
 * consumed and reported as a ProtocolError so the device — which gets no ack —
 * resends it instead of the stream desynchronising.
 */
export function frameTeltonika(reader: ByteReader, receivedAt: Date): RawPacket | typeof NEED_MORE {
  // Discard TCP pings.
  while (reader.available > 0 && reader.peek(1)[0] === PING_BYTE) reader.read(1);
  if (reader.available < 2) return NEED_MORE;

  const head = reader.peek(2);
  if (head[0] === 0 && head[1] === 0) return frameAvl(reader, receivedAt);
  return frameImei(reader, receivedAt, head.readUInt16BE(0));
}

function frameImei(
  reader: ByteReader,
  receivedAt: Date,
  length: number,
): RawPacket | typeof NEED_MORE {
  if (length !== IMEI_LENGTH) {
    // Not Teltonika framing at all — drop the buffer so we do not scan garbage.
    reader.clear();
    throw new ProtocolError(`Teltonika IMEI frame has invalid length ${length}.`, 'teltonika');
  }
  const total = 2 + length;
  if (reader.available < total) return NEED_MORE;
  const frame = reader.read(total);
  if (frame === NEED_MORE) return NEED_MORE;
  if (!/^\d{15}$/.test(frame.subarray(2).toString('latin1'))) {
    throw new ProtocolError('Teltonika IMEI frame is not 15 ASCII digits.', 'teltonika');
  }
  return new RawPacket({
    protocolId: 'teltonika',
    payload: Buffer.from(frame),
    receivedAt,
    direction: 'INBOUND',
  });
}

function frameAvl(reader: ByteReader, receivedAt: Date): RawPacket | typeof NEED_MORE {
  if (reader.available < AVL_HEADER_BYTES) return NEED_MORE;
  const dataLength = reader.peek(AVL_HEADER_BYTES).readUInt32BE(4);
  if (dataLength < 3 || dataLength > MAX_DATA_BYTES) {
    reader.clear();
    throw new ProtocolError(`Teltonika AVL data length ${dataLength} out of range.`, 'teltonika');
  }
  const total = AVL_HEADER_BYTES + dataLength + AVL_CRC_BYTES;
  if (reader.available < total) return NEED_MORE;
  const frame = reader.read(total);
  if (frame === NEED_MORE) return NEED_MORE;

  const data = frame.subarray(AVL_HEADER_BYTES, AVL_HEADER_BYTES + dataLength);
  const expected = teltonikaCrc16(data);
  const received = frame.readUInt32BE(AVL_HEADER_BYTES + dataLength);
  if (received !== expected) {
    throw new ProtocolError(
      `Teltonika CRC mismatch: got 0x${received.toString(16)}, expected 0x${expected.toString(16)}.`,
      'teltonika',
    );
  }
  return new RawPacket({
    protocolId: 'teltonika',
    payload: Buffer.from(frame),
    receivedAt,
    direction: 'INBOUND',
  });
}

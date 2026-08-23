/**
 * Meitrack MDVR binary streaming media packet (MDVR GPRS Protocol V2.0 §3.16).
 *
 * The device pushes media over a dedicated TCP connection (the "video port"
 * advertised in the A9A command struct). Every packet starts with the 0x12
 * frame-header flag followed by a fixed 28-byte header:
 *
 *   off  field                      type
 *   0    Frame header flag          BYTE   0x12
 *   1    m_pt                       BYTE   (payloadType << 1) | isLastPacket
 *   2    Data packet No.            WORD   big-endian
 *   4    IMEI                       BCD[8]
 *   12   Logical channel number     BYTE
 *   13   Data type & packet flag    BYTE   (hi nibble dataType, lo nibble packetFlag)
 *   14   Timestamp                  BYTE[8] ms, big-endian
 *   22   Previous I-frame interval  WORD   ms, big-endian
 *   24   Previous frame interval    WORD   ms, big-endian
 *   26   Data body length           WORD   big-endian (<= 950 per spec)
 *   28   Data body                  BYTE[n]
 *
 * Ported from the proven standalone implementation (md300/live.js pipeline)
 * where these offsets were validated against a real MD300 device.
 */

/** Fixed header size including the 0x12 flag byte. */
export const MEDIA_HEADER_SIZE = 28;

/** Payload type = m_pt >> 1 (§3.16 table). */
export const PayloadTypes = {
  H264: 98,
  H265: 99,
  G726_AUDIO: 8,
  G711A_AUDIO: 6,
  GPS_DATA: 45,
} as const;

/** Hi nibble of the data-type byte. */
export const DataTypes = {
  I_FRAME: 0x0,
  P_FRAME: 0x1,
  B_FRAME: 0x2,
  AUDIO_FRAME: 0x3,
  TRANSPARENT_DATA: 0x4,
} as const;

/** Lo nibble of the data-type byte — fragment position. */
export const PacketFlags = {
  COMPLETE: 0x0,
  FIRST: 0x1,
  LAST: 0x2,
  MIDDLE: 0x3,
} as const;

export function payloadTypeName(pt: number): string {
  switch (pt) {
    case PayloadTypes.H264:
      return 'H264';
    case PayloadTypes.H265:
      return 'H265';
    case PayloadTypes.G726_AUDIO:
      return 'G.726';
    case PayloadTypes.G711A_AUDIO:
      return 'G.711A';
    case PayloadTypes.GPS_DATA:
      return 'GPS';
    default:
      return `Unknown(${pt})`;
  }
}

export function dataTypeName(dt: number): string {
  switch (dt) {
    case DataTypes.I_FRAME:
      return 'I-Frame';
    case DataTypes.P_FRAME:
      return 'P-Frame';
    case DataTypes.B_FRAME:
      return 'B-Frame';
    case DataTypes.AUDIO_FRAME:
      return 'Audio';
    case DataTypes.TRANSPARENT_DATA:
      return 'Transparent';
    default:
      return `Unknown(${dt})`;
  }
}

export function packetFlagName(pf: number): string {
  switch (pf) {
    case PacketFlags.COMPLETE:
      return 'Complete';
    case PacketFlags.FIRST:
      return 'First';
    case PacketFlags.LAST:
      return 'Last';
    case PacketFlags.MIDDLE:
      return 'Middle';
    default:
      return `Unknown(${pf})`;
  }
}

/** A fully parsed media packet. `payload` is a view into the source buffer. */
export interface MeitrackMediaPacket {
  /** Total bytes consumed (header + body) — advance the stream by this. */
  readonly totalLength: number;
  readonly payloadType: number;
  readonly payloadTypeStr: string;
  readonly isLastPacket: boolean;
  readonly packetNo: number;
  readonly imei: string;
  readonly channel: number;
  readonly dataType: number;
  readonly dataTypeStr: string;
  readonly packetFlag: number;
  readonly packetFlagStr: string;
  /** Capture timestamp in ms since epoch (device clock). */
  readonly timestamp: number;
  readonly dataLength: number;
  readonly payload: Buffer;
}

export type ParseMediaPacketResult =
  | { readonly status: 'incomplete'; readonly need: number }
  | { readonly status: 'invalid' }
  | { readonly status: 'ok'; readonly packet: MeitrackMediaPacket };

/** Decode a BCD byte buffer to a digit string ('?' for invalid nibbles). */
export function bcdToString(bcd: Buffer): string {
  let s = '';
  for (const b of bcd) {
    const hi = (b >> 4) & 0x0f;
    const lo = b & 0x0f;
    s += (hi > 9 ? '?' : hi).toString() + (lo > 9 ? '?' : lo).toString();
  }
  return s;
}

/**
 * Normalize a BCD IMEI (16 nibbles) to the canonical 15-digit IMEI form used
 * everywhere else in the platform (GPRS frames, device registry): §3.16 pads
 * the 15-digit IMEI with ONE leading '0' into BCD[8]. Stripping that pad keeps
 * video-plane room keys identical to the command-plane device identity.
 */
export function normalizeImei(raw: string): string {
  if (raw.length === 16 && raw.startsWith('0')) return raw.slice(1);
  return raw;
}

/**
 * Parse ONE media packet at the start of `buf`. The caller guarantees stream
 * alignment (buf[0] === 0x12 or resyncs via findPacketStart first).
 *
 * - incomplete → more bytes needed (`need` = total expected length)
 * - invalid    → not a parseable 0x12 header (caller should resync)
 * - ok         → packet parsed; consume `packet.totalLength` bytes
 */
export function parseMediaPacket(buf: Buffer): ParseMediaPacketResult {
  if (buf.length < MEDIA_HEADER_SIZE) {
    return { status: 'incomplete', need: MEDIA_HEADER_SIZE };
  }
  if (buf[0] !== 0x12) return { status: 'invalid' };

  const mPt = buf[1] ?? 0;
  const payloadType = mPt >> 1;
  const isLastPacket = (mPt & 0x01) === 1;

  const packetNo = buf.readUInt16BE(2);
  const imei = normalizeImei(bcdToString(buf.subarray(4, 12)));
  const channel = buf[12] ?? 0;
  const dtFlag = buf[13] ?? 0;
  const dataType = (dtFlag >> 4) & 0x0f;
  const packetFlag = dtFlag & 0x0f;

  const timestamp = Number(buf.readBigUInt64BE(14));
  const dataLength = buf.readUInt16BE(26);

  const totalLength = MEDIA_HEADER_SIZE + dataLength;
  if (buf.length < totalLength) {
    return { status: 'incomplete', need: totalLength };
  }

  const payload = buf.subarray(MEDIA_HEADER_SIZE, totalLength);
  return {
    status: 'ok',
    packet: {
      totalLength,
      payloadType,
      payloadTypeStr: payloadTypeName(payloadType),
      isLastPacket,
      packetNo,
      imei,
      channel,
      dataType,
      dataTypeStr: dataTypeName(dataType),
      packetFlag,
      packetFlagStr: packetFlagName(packetFlag),
      timestamp,
      dataLength,
      payload,
    },
  };
}

/**
 * Scan for the next candidate 0x12 header offset (resync past junk bytes).
 * Returns -1 when none is found.
 */
export function findPacketStart(buf: Buffer): number {
  return buf.indexOf(0x12);
}

/**
 * Build a synthetic media packet — used by the device simulator and tests.
 */
export function buildMediaPacket(fields: {
  imei: string;
  channel: number;
  dataType: number;
  packetFlag: number;
  payloadType: number;
  packetNo: number;
  timestamp: number;
  payload: Buffer;
}): Buffer {
  const imeiDigits = fields.imei.replace(/\D/g, '').padStart(16, '0').slice(0, 16);
  const imeiBcd = Buffer.alloc(8);
  for (let i = 0; i < 16; i += 2) {
    const hi = Number.parseInt(imeiDigits[i] ?? '0', 16);
    const lo = Number.parseInt(imeiDigits[i + 1] ?? '0', 16);
    imeiBcd[i / 2] = (hi << 4) | lo;
  }
  const header = Buffer.alloc(MEDIA_HEADER_SIZE);
  header[0] = 0x12;
  header[1] = ((fields.payloadType & 0x7f) << 1) | 0;
  header.writeUInt16BE(fields.packetNo & 0xffff, 2);
  imeiBcd.copy(header, 4);
  header[12] = fields.channel & 0xff;
  header[13] = ((fields.dataType & 0x0f) << 4) | (fields.packetFlag & 0x0f);
  header.writeBigUInt64BE(BigInt(fields.timestamp), 14);
  header.writeUInt16BE(0, 22); // prev I-frame interval (unused)
  header.writeUInt16BE(0, 24); // prev frame interval (unused)
  header.writeUInt16BE(fields.payload.length, 26);
  return Buffer.concat([header, fields.payload]);
}

/**
 * JT808 message header — parse + build, message-ID constants, BCD helpers
 * (JT/T 808-2019 §"消息头"). Shared by decode + encode so the bit layout lives in
 * exactly one place.
 *
 * Header layout (after the leading 0x7e):
 *   msgId(2 BE) bodyProps(2 BE) [protoVer(1)] phone(BCD 6|10) msgSn(2 BE)
 *   [fragTotal(2) fragSn(2)]   ← only when bodyProps bit13 (subcontract) = 1
 *
 * bodyProps word bit layout:
 *   bits 0–9  (0x03FF) body length (bytes)
 *   bits 10–12(0x1C00) encryption type (0 = none; 1 = RSA; …)
 *   bit  13   (0x2000) subcontract (分包) flag
 *   bit  14   (0x4000) version flag — 1 ⇒ 2019 (protoVer byte present, phone=10 BCD)
 *   bit  15   (0x8000) reserved
 */
import { ProtocolError } from '../../../domain/errors.js';

/** Message IDs we understand (subset). */
export const MSG = {
  // Device → platform.
  TERMINAL_GENERAL_RESPONSE: 0x0001, // 终端通用应答
  HEARTBEAT: 0x0002, // 终端心跳
  REGISTER: 0x0100, // 终端注册
  AUTH: 0x0102, // 终端鉴权
  LOCATION: 0x0200, // 位置上报
  LOCATION_QUERY_RESPONSE: 0x0201, // 位置查询应答 (seq + 0x0200 block)
  EVENT_REPORT: 0x0301, // 事件报告 (body = event-id byte)
  // Platform → device.
  PLATFORM_GENERAL_RESPONSE: 0x8001, // 平台通用应答
  REGISTER_RESPONSE: 0x8100, // 注册应答
  TERMINAL_CONTROL: 0x8105, // 终端控制
  SET_PARAMETERS: 0x8103, // 设置终端参数
  TERMINAL_UPGRADE: 0x8108, // 终端升级
} as const;

// bodyProps bit masks.
const BODY_LENGTH_MASK = 0x03ff;
const ENCRYPTION_MASK = 0x1c00;
const SUBCONTRACT_BIT = 0x2000;
const VERSION_BIT = 0x4000;

/** Parsed JT808 header + a slice over the unstuffed frame body. */
export interface Jt808Header {
  readonly msgId: number;
  readonly bodyProps: number;
  readonly bodyLength: number;
  readonly encryption: number;
  readonly subcontract: boolean;
  /** Protocol version byte (2019 only); null for 2013. */
  readonly version: number | null;
  /** Phone number as BCD digits (string, may carry leading zeros). */
  readonly phone: string;
  readonly msgSn: number;
  /** Subcontract total (fragTotal) when bit13 set, else null. */
  readonly fragTotal: number | null;
  /** Subcontract index (fragSn) when bit13 set, else null. */
  readonly fragSn: number | null;
  /** Offset of the body within the unstuffed frame (after the leading 0x7e). */
  readonly bodyOffset: number;
}

/**
 * Parse the header of an unstuffed JT808 frame. `frame` is the full RawPacket
 * payload (leading 0x7e … trailing 0x7e, already unstuffed by the framer). The
 * returned `bodyOffset` is relative to `frame` (i.e. includes the leading flag).
 */
export function parseHeader(frame: Buffer): Jt808Header {
  // Skip the leading 0x7e; read from offset 1.
  let off = 1;
  if (frame.length < off + 4) {
    throw new ProtocolError(`JT808 header too short (${frame.length} bytes).`, 'jt808');
  }
  const msgId = frame.readUInt16BE(off);
  off += 2;
  const bodyProps = frame.readUInt16BE(off);
  off += 2;

  const bodyLength = bodyProps & BODY_LENGTH_MASK;
  const encryption = (bodyProps & ENCRYPTION_MASK) >>> 10;
  const subcontract = (bodyProps & SUBCONTRACT_BIT) !== 0;
  const is2019 = (bodyProps & VERSION_BIT) !== 0;

  let version: number | null = null;
  if (is2019) {
    version = frame[off] ?? 0;
    off += 1;
  }

  // Phone: BCD 6 bytes (2013) or 10 bytes (2019).
  const phoneBytes = is2019 ? 10 : 6;
  if (frame.length < off + phoneBytes) {
    throw new ProtocolError('JT808 header truncated before phone.', 'jt808');
  }
  const phone = bcdToString(frame.subarray(off, off + phoneBytes));
  off += phoneBytes;

  if (frame.length < off + 2) {
    throw new ProtocolError('JT808 header truncated before msgSn.', 'jt808');
  }
  const msgSn = frame.readUInt16BE(off);
  off += 2;

  let fragTotal: number | null = null;
  let fragSn: number | null = null;
  if (subcontract) {
    if (frame.length < off + 4) {
      throw new ProtocolError('JT808 header truncated before subcontract fields.', 'jt808');
    }
    fragTotal = frame.readUInt16BE(off);
    off += 2;
    fragSn = frame.readUInt16BE(off);
    off += 2;
  }

  return {
    msgId,
    bodyProps,
    bodyLength,
    encryption,
    subcontract,
    version,
    phone,
    msgSn,
    fragTotal,
    fragSn,
    bodyOffset: off,
  };
}

/** Return the body slice of an unstuffed frame (header already parsed). */
export function bodyOf(frame: Buffer, header: Jt808Header): Buffer {
  // body ends before the 1-byte checksum and the trailing 0x7e.
  const bodyEnd = frame.length - 2; // exclude checksum(1) + trailing flag(1)
  return frame.subarray(header.bodyOffset, bodyEnd);
}

/** Render a BCD byte buffer to its decimal digit string (e.g. 0x12 → "12"). */
export function bcdToString(buf: Buffer): string {
  let s = '';
  for (const b of buf) {
    s += ((b ?? 0) >>> 4).toString(16);
    s += ((b ?? 0) & 0x0f).toString(16);
  }
  return s;
}

/** Encode a decimal digit string into BCD bytes (left-padded with 0 to width). */
export function stringToBcd(digits: string, widthBytes: number): Buffer {
  const padded = digits.padStart(widthBytes * 2, '0').slice(-widthBytes * 2);
  const out = Buffer.alloc(widthBytes);
  for (let i = 0; i < widthBytes; i++) {
    const hi = padded[i * 2] ?? '0';
    const lo = padded[i * 2 + 1] ?? '0';
    out[i] = (Number.parseInt(hi, 16) << 4) | Number.parseInt(lo, 16);
  }
  return out;
}

export { ENCRYPTION_MASK, VERSION_BIT, BODY_LENGTH_MASK, SUBCONTRACT_BIT };

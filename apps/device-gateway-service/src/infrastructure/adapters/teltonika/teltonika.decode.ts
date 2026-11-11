/**
 * Teltonika decode — framed packet → canonical DeviceMessage(s) (06 §10.2).
 *
 *   IMEI frame            → LOGIN (serialOrImei = the 15 digits)
 *   AVL, codec 8 / 8E / 16 → per record: POSITION (valid GNSS fix) or TELEMETRY
 *                            (no fix), plus an ALARM when the record was
 *                            triggered by an alarm-class event IO
 *   AVL, codec 12          → COMMAND_ACK carrying the device's text response
 *
 * An AVL packet carries no IMEI — the device identifies itself once, in the
 * login frame. The dispatcher binds that session identity onto every message.
 *
 * Record layout (all big-endian):
 *   timestamp u64 ms UTC · priority u8 · lon i32 · lat i32 (deg × 1e7) ·
 *   altitude i16 m · angle u16 · satellites u8 · speed u16 km/h ·
 *   event IO id · IO count · [IO groups of 1/2/4/8-byte values] ·
 *   (codec 8E only) variable-length group.
 *
 * | codec | IO id / count width | extras                                 |
 * |-------|---------------------|----------------------------------------|
 * | 0x08  | 1 B                 | —                                      |
 * | 0x8E  | 2 B                 | NX group of variable-length values     |
 * | 0x10  | 2 B id, 1 B count   | generation-type byte after event IO id |
 */
import { createHash } from 'node:crypto';
import { DeviceMessage, type Position } from '../../../domain/device-message.js';
import { ProtocolError } from '../../../domain/errors.js';
import type { RawPacket } from '../../../domain/raw-packet.js';
import { ALARM_EVENTS, IO_CATALOG, IO_IGNITION } from './teltonika.codes.js';
import { AVL_HEADER_BYTES, TELTONIKA_CODEC, isImeiFrame } from './teltonika.frames.js';

type IoValue = number | bigint | Buffer;
/** An IO element with the byte width it had on the wire (needed for signed values). */
interface IoEntry {
  readonly value: IoValue;
  readonly width: number;
}

interface CodecLayout {
  readonly idBytes: 1 | 2;
  readonly countBytes: 1 | 2;
  readonly generationByte: boolean;
  readonly variableGroup: boolean;
}

const LAYOUTS: Readonly<Record<number, CodecLayout>> = {
  [TELTONIKA_CODEC.CODEC_8]: {
    idBytes: 1,
    countBytes: 1,
    generationByte: false,
    variableGroup: false,
  },
  [TELTONIKA_CODEC.CODEC_8_EXT]: {
    idBytes: 2,
    countBytes: 2,
    generationByte: false,
    variableGroup: true,
  },
  [TELTONIKA_CODEC.CODEC_16]: {
    idBytes: 2,
    countBytes: 1,
    generationByte: true,
    variableGroup: false,
  },
};

interface AvlRecord {
  readonly timestampMs: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly altitude: number;
  readonly angle: number;
  readonly satellites: number;
  readonly speed: number;
  readonly eventIoId: number;
  readonly io: ReadonlyMap<number, IoEntry>;
}

/** Bounds-checked big-endian reader; an overrun is a malformed packet. */
class Cursor {
  private pos: number;
  constructor(
    private readonly buf: Buffer,
    start: number,
  ) {
    this.pos = start;
  }
  public get offset(): number {
    return this.pos;
  }
  private take(n: number): number {
    if (this.pos + n > this.buf.length) {
      throw new ProtocolError('Teltonika AVL record truncated.', 'teltonika');
    }
    const at = this.pos;
    this.pos += n;
    return at;
  }
  public u8(): number {
    return this.buf.readUInt8(this.take(1));
  }
  public u16(): number {
    return this.buf.readUInt16BE(this.take(2));
  }
  public i16(): number {
    return this.buf.readInt16BE(this.take(2));
  }
  public i32(): number {
    return this.buf.readInt32BE(this.take(4));
  }
  public u32(): number {
    return this.buf.readUInt32BE(this.take(4));
  }
  public u64(): bigint {
    return this.buf.readBigUInt64BE(this.take(8));
  }
  public uN(width: 1 | 2): number {
    return width === 1 ? this.u8() : this.u16();
  }
  public bytes(n: number): Buffer {
    const at = this.take(n);
    return this.buf.subarray(at, at + n);
  }
  /** Unsigned value of a fixed IO width (1, 2, 4 or 8 bytes). */
  public io(width: 1 | 2 | 4 | 8): number | bigint {
    switch (width) {
      case 1:
        return this.u8();
      case 2:
        return this.u16();
      case 4:
        return this.u32();
      default:
        return this.u64();
    }
  }
}

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

function build(
  raw: RawPacket,
  imei: string,
  partial: Pick<DeviceMessage, 'type' | 'timestamp'> &
    Partial<Pick<DeviceMessage, 'position' | 'alarms' | 'telemetry' | 'io'>>,
): DeviceMessage {
  return new DeviceMessage({
    messageId: globalThis.crypto.randomUUID(),
    deviceId: '',
    tenantId: '',
    serialOrImei: imei,
    protocolId: 'teltonika',
    type: partial.type,
    timestamp: partial.timestamp,
    ingestedAt: raw.receivedAt,
    position: partial.position,
    alarms: partial.alarms,
    telemetry: partial.telemetry,
    io: partial.io,
    rawSize: raw.rawSize,
    checksum: sha256(raw.payload),
    direction: raw.direction,
  });
}

/**
 * Decode a framed Teltonika packet. Throws ProtocolError for an unsupported
 * codec or a structurally inconsistent packet (the dispatcher drops it and the
 * device, un-acked, resends).
 */
export function decodeTeltonika(raw: RawPacket): readonly DeviceMessage[] {
  const p = raw.payload;

  if (isImeiFrame(p)) {
    return [
      build(raw, p.subarray(2).toString('latin1'), { type: 'LOGIN', timestamp: raw.receivedAt }),
    ];
  }

  if (p.length < AVL_HEADER_BYTES + 3) {
    throw new ProtocolError(`Teltonika packet too short (${p.length} bytes).`, 'teltonika');
  }
  const codec = p.readUInt8(AVL_HEADER_BYTES);
  if (codec === TELTONIKA_CODEC.CODEC_12) return [decodeCodec12(raw)];

  const layout = LAYOUTS[codec];
  if (!layout) {
    throw new ProtocolError(
      `Teltonika codec 0x${codec.toString(16)} not supported (decode).`,
      'teltonika',
    );
  }

  const count = p.readUInt8(AVL_HEADER_BYTES + 1);
  const dataEnd = p.length - 4; // CRC trailer
  const trailingCount = p.readUInt8(dataEnd - 1);
  if (trailingCount !== count) {
    throw new ProtocolError(
      `Teltonika record count mismatch (${count} vs ${trailingCount}).`,
      'teltonika',
    );
  }

  const cursor = new Cursor(p.subarray(0, dataEnd - 1), AVL_HEADER_BYTES + 2);
  const messages: DeviceMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push(...recordToMessages(raw, parseRecord(cursor, layout)));
  }
  if (cursor.offset !== dataEnd - 1) {
    throw new ProtocolError('Teltonika AVL packet has trailing bytes after records.', 'teltonika');
  }
  return messages;
}

/** Number of records in an AVL packet, for the server's acknowledgement. */
export function avlRecordCount(payload: Buffer): number | null {
  if (isImeiFrame(payload) || payload.length < AVL_HEADER_BYTES + 2) return null;
  const codec = payload.readUInt8(AVL_HEADER_BYTES);
  if (!LAYOUTS[codec]) return null;
  return payload.readUInt8(AVL_HEADER_BYTES + 1);
}

function parseRecord(c: Cursor, layout: CodecLayout): AvlRecord {
  const timestampMs = Number(c.u64());
  c.u8(); // priority — carried by the device config, not needed downstream
  const longitude = c.i32() / 1e7;
  const latitude = c.i32() / 1e7;
  const altitude = c.i16();
  const angle = c.u16();
  const satellites = c.u8();
  const speed = c.u16();

  const eventIoId = c.uN(layout.idBytes);
  if (layout.generationByte) c.u8();
  c.uN(layout.countBytes); // total IO count — the groups below are authoritative

  const io = new Map<number, IoEntry>();
  for (const width of [1, 2, 4, 8] as const) {
    const n = c.uN(layout.countBytes);
    for (let i = 0; i < n; i++) {
      const id = c.uN(layout.idBytes);
      io.set(id, { value: c.io(width), width });
    }
  }
  if (layout.variableGroup) {
    const n = c.u16();
    for (let i = 0; i < n; i++) {
      const id = c.u16();
      const bytes = Buffer.from(c.bytes(c.u16()));
      io.set(id, { value: bytes, width: bytes.length });
    }
  }
  return { timestampMs, latitude, longitude, altitude, angle, satellites, speed, eventIoId, io };
}

/** Plain JSON-safe number: bigint beyond 2^53 and byte blobs become strings. */
function jsonValue(v: IoValue): number | string {
  if (Buffer.isBuffer(v)) return v.toString('hex');
  if (typeof v === 'bigint') {
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  }
  return v;
}

function signed(value: number, widthBytes: number): number {
  const bits = widthBytes * 8;
  return value >= 2 ** (bits - 1) ? value - 2 ** bits : value;
}

function numeric(e: IoEntry | undefined): number | null {
  if (e === undefined || Buffer.isBuffer(e.value)) return null;
  return Number(e.value);
}

/** Named telemetry fields from the catalogued IO elements. */
function buildTelemetry(io: ReadonlyMap<number, IoEntry>): Record<string, unknown> {
  const telemetry: Record<string, unknown> = {};
  for (const [id, entry] of io) {
    const d = IO_CATALOG[id];
    const n = numeric(entry);
    if (!d || n === null) continue;
    if (d.bool) {
      telemetry[d.name] = n !== 0;
      continue;
    }
    const base = d.signed ? signed(n, entry.width) : n;
    // Round away float noise from scales like 0.1 (e.g. 215 × 0.1).
    telemetry[d.name] = d.scale ? Math.round(base * d.scale * 1000) / 1000 : base;
  }
  return telemetry;
}

function recordToMessages(raw: RawPacket, r: AvlRecord): DeviceMessage[] {
  const imei = ''; // identity comes from the session, not the AVL packet
  const timestamp = recordTime(r.timestampMs, raw.receivedAt);
  const hasFix =
    r.satellites > 0 &&
    Math.abs(r.latitude) <= 90 &&
    Math.abs(r.longitude) <= 180 &&
    !(r.latitude === 0 && r.longitude === 0);

  const ignition = numeric(r.io.get(IO_IGNITION));
  const ignitionOn = ignition === null ? null : ignition !== 0;
  const position: Position | undefined = hasFix
    ? {
        latitude: r.latitude,
        longitude: r.longitude,
        speedKph: r.speed,
        headingDeg: r.angle,
        altitudeM: r.altitude,
        satellites: r.satellites,
        timestamp,
        ignitionOn,
      }
    : undefined;

  const telemetry = { ...buildTelemetry(r.io), ignitionOn, fixValid: hasFix };
  const io: Record<string, unknown> = {};
  for (const [id, e] of r.io) io[String(id)] = jsonValue(e.value);

  const out: DeviceMessage[] = [];

  const raised = r.eventIoId !== 0 ? alarmFor(r) : null;
  if (raised) {
    out.push(
      build(raw, imei, { type: 'ALARM', timestamp, position, alarms: [raised], telemetry, io }),
    );
  }
  if (position) {
    out.push(build(raw, imei, { type: 'POSITION', timestamp, position, telemetry, io }));
  } else if (!raised) {
    out.push(build(raw, imei, { type: 'TELEMETRY', timestamp, telemetry, io }));
  }
  return out;
}

function alarmFor(r: AvlRecord) {
  const map = ALARM_EVENTS[r.eventIoId];
  const value = numeric(r.io.get(r.eventIoId));
  if (!map || value === null || value === 0) return null;
  return map(value);
}

/** Device clock; falls back to receive time when it is unset or implausible. */
function recordTime(ms: number, receivedAt: Date): Date {
  const MIN = Date.UTC(2015, 0, 1);
  const MAX = receivedAt.getTime() + 24 * 3600_000;
  return ms >= MIN && ms <= MAX ? new Date(ms) : receivedAt;
}

/** Codec 12: 0C · qty · type(0x06 = response) · size u32 · text · qty. */
function decodeCodec12(raw: RawPacket): DeviceMessage {
  const p = raw.payload;
  const base = AVL_HEADER_BYTES;
  const type = p.readUInt8(base + 2);
  const size = p.readUInt32BE(base + 3);
  if (type !== 0x06 || base + 7 + size > p.length - 4) {
    throw new ProtocolError('Teltonika codec 12 packet is not a valid response.', 'teltonika');
  }
  const response = p.subarray(base + 7, base + 7 + size).toString('utf8');
  return build(raw, '', {
    type: 'COMMAND_ACK',
    timestamp: raw.receivedAt,
    telemetry: { command: 'CODEC12', response },
  });
}

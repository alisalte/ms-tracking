/**
 * Meitrack decode — vendor frame → canonical DeviceMessage (06 §10.2 normalization).
 *
 * Handles the tracking-family packets needed to prove the pipeline end-to-end
 * (Meitrack GPRS Protocol v1.6 + MDVR GPRS Protocol V2.0):
 *   - AAA tracking, event 0  → POSITION (lat/lng/speed/heading/time/sats + IO).
 *   - AAA tracking, event≠0  → ALARM (carries the same position + mapped alarm).
 *   - AAC / D82 / any echoed command code (A11, B05, …) → COMMAND_ACK.
 *
 * Auth note: Meitrack sends NO dedicated login packet — the 15-digit IMEI is the
 * first field of *every* packet. Each decoded message therefore carries the IMEI
 * in `serialOrImei`, and the dispatcher's implicit-login path (06 §7) authenticates
 * off the first packet of a connection. This mirrors the reference Traccar model
 * (`getDeviceSession(channel, imei)`).
 *
 * Field order of the AAA body (verified against the reference decoder PATTERN):
 *   imei, command, event, lat, lng, YYMMDDHHMMSS, validity(A|V), satellites,
 *   rssi, speed(km/h), heading, hdop, altitude, odometer, runtime,
 *   mcc|mnc|lac|cid, input(hex), output(hex), [battery|power | adc...], ...
 * Coordinates are signed decimal degrees (negative = S/W). Cell-tower block uses
 * `|` separators inside one comma-field.
 */
import { createHash } from 'node:crypto';
import { DeviceMessage, type Position } from '../../../domain/device-message.js';
import { ProtocolError } from '../../../domain/errors.js';
import type { RawPacket } from '../../../domain/raw-packet.js';
import { mapDmsAlarmType, mapMeitrackEvent } from './meitrack.codes.js';
import { MEITRACK_COMMAND } from './meitrack.frames.js';

/** Parsed tracking-family frame: $$<id><len>,<body>*<cc>\r\n → command + body fields. */
interface MeitrackFrame {
  /** 3-char command code, e.g. 'AAA' | 'AAC' | 'D82'. */
  readonly command: string;
  /**
   * Comma-separated body fields (the content after the length comma, before `*`),
   * checksum-verified. Field layout: `fields[0]` = IMEI, `fields[1]` = command,
   * then the command-specific payload (event, lat/lng, … for AAA).
   */
  readonly fields: readonly string[];
}

/** Minimal frame parse: split command + comma body, dropping flag/length/checksum. */
function parseFrame(payload: Buffer): MeitrackFrame {
  const text = payload.toString('ascii');
  // $$<id><len>,<body>*<cc>\r\n  — body = imei,command,...
  if (text.length < 10 || !text.startsWith('$$')) {
    throw new ProtocolError(`Meitrack frame malformed (${text.length} bytes).`, 'meitrack');
  }
  const starIdx = text.lastIndexOf('*');
  if (starIdx < 0) {
    throw new ProtocolError('Meitrack frame missing checksum separator.', 'meitrack');
  }
  const body = text.slice(text.indexOf(',') + 1, starIdx);
  const fields = body.split(',');
  // fields[0] = IMEI, fields[1] = command (AAA/D82/…).
  const command = fields[1] ?? '';
  if (command.length < 3) {
    throw new ProtocolError(`Meitrack command field too short: '${command}'.`, 'meitrack');
  }
  return { command: command.slice(0, 3), fields };
}

/** Build the canonical DeviceMessage scaffold. */
function message(
  raw: RawPacket,
  partial: Pick<DeviceMessage, 'type' | 'timestamp'> &
    Partial<Pick<DeviceMessage, 'position' | 'alarms' | 'telemetry' | 'io' | 'serialOrImei'>>,
): DeviceMessage {
  return new DeviceMessage({
    messageId: globalThis.crypto.randomUUID(),
    deviceId: '',
    tenantId: '',
    serialOrImei: partial.serialOrImei ?? '',
    protocolId: 'meitrack',
    type: partial.type,
    timestamp: partial.timestamp,
    ingestedAt: raw.receivedAt,
    position: partial.position,
    alarms: partial.alarms,
    telemetry: partial.telemetry,
    io: partial.io,
    rawSize: raw.rawSize,
    checksum: createHash('sha256').update(raw.payload).digest('hex'),
    direction: raw.direction,
  });
}

/**
 * Decode a Meitrack RawPacket into one DeviceMessage. Throws ProtocolError on an
 * unsupported/undersized frame so the dispatcher's decode stage drops it and
 * bumps `decode.error` (06 §8).
 *
 * MDVR command responses (Meitrack MDVR GPRS Protocol V2.0 §3.x): a device
 * replies to a downstream command by ECHOING its code — `$$S28,…,A11,OK` —
 * not only via D82. Any well-formed 3-char command code other than AAA is
 * therefore decoded as a COMMAND_ACK carrying `telemetry.command` (the echoed
 * code) + `telemetry.response` (the result payload, e.g. 'OK').
 */
export function decodeMeitrack(raw: RawPacket): readonly DeviceMessage[] {
  const frame = parseFrame(raw.payload);

  // CCE bodies are BINARY (comma-splitting is invalid) — parse from the raw
  // buffer before the text path.
  if (isCceFrame(raw.payload)) {
    return decodeCce(raw);
  }

  switch (frame.command) {
    case MEITRACK_COMMAND.TRACKING:
      return [decodeTracking(raw, frame.fields)];
    default:
      // Command-family code (AAC, D82, A##, B##, C##, D##, E##, F##) → ack.
      if (MEITRACK_RESPONSE_CODE.test(frame.command)) {
        return [decodeCommandAck(raw, frame.fields)];
      }
      throw new ProtocolError(
        `Meitrack command '${frame.command}' not supported (decode).`,
        'meitrack',
      );
  }
}

/** 3-char command-family code (letter + 2 alphanumerics), excluding AAA. */
const MEITRACK_RESPONSE_CODE = /^(?!AAA)[A-F][0-9A-Z]{2}$/;

/** Decode an AAA tracking packet → POSITION (event 0) or ALARM (event≠0). */
function decodeTracking(raw: RawPacket, fields: readonly string[]): DeviceMessage {
  // fields[0] = imei; fields[1] = command (AAA); fields[2] = event; then position.
  const imei = fields[0] ?? '';
  if (!imei) {
    throw new ProtocolError('Meitrack tracking packet missing IMEI.', 'meitrack');
  }
  const event = Number.parseInt(fields[2] ?? '', 10);
  if (Number.isNaN(event)) {
    throw new ProtocolError(
      `Meitrack tracking packet has non-numeric event '${fields[2]}'.`,
      'meitrack',
    );
  }

  const pos = parsePosition(fields);
  const isAlarm = event !== 0;
  const type = isAlarm ? 'ALARM' : 'POSITION';
  const alarms = isAlarm ? [mapMeitrackEvent(event)] : undefined;

  // Extra IO/telemetry retained for traceability (06 §10.2 raw IO map).
  const io = parseIo(fields);

  return message(raw, {
    type,
    serialOrImei: imei,
    timestamp: pos.timestamp,
    position: pos,
    alarms,
    telemetry: {
      ignitionOn: pos.ignitionOn,
      hdop: io.hdop,
      odometerKm: io.odometerKm,
      batteryVoltage: io.batteryVoltage,
      powerVoltage: io.powerVoltage,
    },
    io: io.raw,
  });
}

/** Decode an AAC/D82 command-acknowledgement → COMMAND_ACK. */
function decodeCommandAck(raw: RawPacket, fields: readonly string[]): DeviceMessage {
  // fields[0] = imei; fields[1] = command (D82/AAC); remainder = result payload.
  const imei = fields[0] ?? '';
  const command = fields[1] ?? '';
  const payload = fields.slice(2).join(',');
  return message(raw, {
    type: 'COMMAND_ACK',
    serialOrImei: imei,
    timestamp: raw.receivedAt,
    telemetry: { command, response: payload },
  });
}

/**
 * Parse the AAA position fields into a canonical Position. Coordinates are signed
 * decimal degrees; speed is km/h; time is UTC (device clock).
 *
 * Field indices (verified against the reference decoder PATTERN):
 *   3 lat, 4 lng, 5 YYMMDDHHMMSS, 6 validity, 7 sats, 8 rssi, 9 speed,
 *   10 heading, 11 hdop, 12 altitude, 13 odometer, 14 runtime,
 *   15 mcc|mnc|lac|cid, 16 input(hex), 17 output(hex), 18+ battery/power...
 */
function parsePosition(fields: readonly string[]): Position {
  const lat = Number.parseFloat(fields[3] ?? '');
  const lng = Number.parseFloat(fields[4] ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ProtocolError(
      `Meitrack GPS fields invalid (lat='${fields[3]}', lng='${fields[4]}').`,
      'meitrack',
    );
  }
  const timestamp = parseDateTime(fields[5] ?? '');
  const valid = (fields[6] ?? 'V') === 'A'; // 'A' = valid fix, 'V' = invalid
  const satellites = Number.parseInt(fields[7] ?? '', 10) || null;
  const speedKph = Number.parseFloat(fields[9] ?? '') || 0;
  const heading = Number.parseFloat(fields[10] ?? '') || 0;
  const altitudeM = Number.parseFloat(fields[12] ?? '') || null;

  // Digital input byte (hex) — bit 0 is the ignition/ACC line on Meitrack trackers.
  const inputHex = fields[16] ?? '00';
  const inputByte = Number.parseInt(inputHex, 16) || 0;
  const ignitionOn = (inputByte & 0x01) !== 0;

  return {
    latitude: lat,
    longitude: lng,
    speedKph: valid ? speedKph : 0,
    headingDeg: heading,
    altitudeM,
    satellites,
    timestamp,
    ignitionOn,
  };
}

/** Parse YYMMDDHHMMSS (UTC, 2-digit year) → Date. Falls back to now on garbage. */
function parseDateTime(s: string): Date {
  // 12 digits: YY MM DD HH MM SS.
  if (!/^\d{12}$/.test(s)) return new Date();
  const yy = Number.parseInt(s.slice(0, 2), 10);
  const mm = Number.parseInt(s.slice(2, 4), 10);
  const dd = Number.parseInt(s.slice(4, 6), 10);
  const hh = Number.parseInt(s.slice(6, 8), 10);
  const mi = Number.parseInt(s.slice(8, 10), 10);
  const ss = Number.parseInt(s.slice(10, 12), 10);
  const d = new Date(Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Extract best-effort telemetry/IO from the variable tail of the AAA body. */
function parseIo(fields: readonly string[]): {
  hdop: number | null;
  odometerKm: number | null;
  batteryVoltage: number | null;
  powerVoltage: number | null;
  raw: Record<string, unknown>;
} {
  const num = (i: number): number | null => {
    const v = Number.parseFloat(fields[i] ?? '');
    return Number.isFinite(v) ? v : null;
  };
  const hdop = num(11);
  const odoRaw = num(13);
  const odometerKm = odoRaw !== null ? odoRaw / 1000 : null; // meters → km

  // Battery/power appear in two layouts (see PATTERN): "batt|power|rtc|mcu|gps,"
  // or raw ADC hex. Detect the decimal layout (first tail field contains a '.').
  let batteryVoltage: number | null = null;
  let powerVoltage: number | null = null;
  const tail0 = fields[18] ?? '';
  if (tail0.includes('.')) {
    const parts = tail0.split('|');
    batteryVoltage = Number.parseFloat(parts[0] ?? '') || null;
    powerVoltage = Number.parseFloat(parts[1] ?? '') || null;
  }

  const raw: Record<string, unknown> = {
    validity: fields[6] ?? null,
    rssi: fields[8] ?? null,
    runtime: fields[14] ?? null,
    cell: fields[15] ?? null,
    input: fields[16] ?? null,
    output: fields[17] ?? null,
  };
  return { hdop, odometerKm, batteryVoltage, powerVoltage, raw };
}

// ── CCE (MDVR binary telemetry/alarm frame, MDVR GPRS Protocol V2.0 §2) ──────

/** Detect `$$…,<imei>,CCE,` frames (the CCE body is binary — never comma-split). */
function isCceFrame(payload: Buffer): boolean {
  const head = payload.subarray(0, Math.min(payload.length, 64)).toString('binary');
  const firstComma = head.indexOf(',');
  const secondComma = head.indexOf(',', firstComma + 1);
  const thirdComma = head.indexOf(',', secondComma + 1);
  if (firstComma === -1 || secondComma === -1 || thirdComma === -1) return false;
  // Command = the SECOND comma field ($$<len>,<imei>,<cmd>,…).
  return head.substring(secondComma + 1, thirdComma) === 'CCE';
}

/** One decoded CCE parameter. */
interface CceParam {
  readonly id: number;
  readonly value: Buffer;
}

/**
 * Parse the CCE parameter stream: three length-prefixed groups — 2-byte IDs,
 * 4-byte IDs, then n-byte IDs (whose IDs are 2 bytes when the first byte is
 * 0xFE, e.g. 0xFE31 ADAS/DMS alarm info).
 */
function parseCceParams(buf: Buffer): CceParam[] {
  const params: CceParam[] = [];
  let off = 0;
  const readId = (): number => {
    const b = buf[off++] ?? 0;
    return b;
  };
  const readU16 = (): number => {
    const v = buf.readUInt16LE(off);
    off += 2;
    return v;
  };
  const readU32 = (): number => {
    const v = buf.readUInt32LE(off);
    off += 4;
    return v;
  };

  // Group 1: N × (1-byte id + 2-byte LE value).
  const n2 = readId();
  for (let i = 0; i < n2 && off + 2 <= buf.length; i++) {
    const id = readId();
    const v = readU16();
    params.push({ id, value: Buffer.from([v & 0xff, (v >> 8) & 0xff]) });
  }
  // Group 2: N × (1-byte id + 4-byte LE value).
  const n4 = readId();
  for (let i = 0; i < n4 && off + 4 <= buf.length; i++) {
    const id = readId();
    const v = readU32();
    params.push({
      id,
      value: Buffer.from([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]),
    });
  }
  // Group 3: N × (id + 1-byte length + value). An id whose first byte is 0xFE
  // is TWO bytes (0xFE31 ADAS/DMS info, 0xFE2D fatigue info, 0x49 camera
  // status is one byte) — per the protocol's worked examples.
  const nn = readId();
  for (let i = 0; i < nn && off < buf.length; i++) {
    let id = readId();
    if (id === 0xfe && off < buf.length) {
      id = ((id << 8) | readId()) & 0xffff;
    }
    const len = off < buf.length ? readId() : 0;
    const value = buf.subarray(off, off + len);
    off += len;
    params.push({ id, value: Buffer.from(value) });
  }
  return params;
}

/** DMS/ADAS detail from CCE parameter 0xFE31 (0xFE2D uses the same tail shape). */
interface DmsDetail {
  readonly protocol: number;
  readonly alarmType: number;
  readonly photoName: string | null;
}

function parseDmsDetail(value: Buffer): DmsDetail | null {
  // <ID_Len><AlarmProtocol><AlarmType><PhotoName…> — ID_Len counts the bytes
  // AFTER it (protocol + type + photo).
  if (value.length < 3) return null;
  const protocol = value[1] ?? 0;
  const alarmType = value[2] ?? 0;
  let photoName: string | null = null;
  const nameBytes = value.subarray(3);
  const zero = nameBytes.indexOf(0);
  const slice = zero >= 0 ? nameBytes.subarray(0, zero) : nameBytes;
  if (slice.length > 0) {
    photoName = slice.toString('ascii').replace(/\x00+$/g, '') || null;
  }
  return { protocol, alarmType, photoName };
}

/**
 * Decode a CCE frame → POSITION and/or ALARM message(s). The event code rides
 * parameter 0x40 (2-byte LE); event 126 carries the DMS/ADAS detail in 0xFE31.
 */
function decodeCce(raw: RawPacket): readonly DeviceMessage[] {
  // Locate the binary body: $$<id><len>,<IMEI>,CCE,<binary…>*<cc>

  const starIdx = raw.payload.lastIndexOf(0x2a);
  if (starIdx < 0) {
    throw new ProtocolError('CCE frame missing checksum separator.', 'meitrack');
  }
  let off = raw.payload.indexOf(0x2c) + 1; // after the length comma
  const imeiEnd = raw.payload.indexOf(0x2c, off);
  const imei = raw.payload.subarray(off, imeiEnd).toString('ascii');
  if (!/^\d{10,17}$/.test(imei)) {
    throw new ProtocolError(`CCE frame has invalid IMEI '${imei}'.`, 'meitrack');
  }
  off = imeiEnd + 1; // at 'CCE'
  off = raw.payload.indexOf(0x2c, off) + 1; // after the CCE comma
  const body = raw.payload.subarray(off, starIdx);
  if (body.length === 0) {
    throw new ProtocolError('CCE frame has an empty body.', 'meitrack');
  }

  const params = parseCceParams(body);
  const byId = new Map<number, CceParam>();
  for (const p of params) byId.set(p.id, p);

  const u16 = (id: number): number | null => {
    const p = byId.get(id);
    return p ? p.value.readUInt16LE(0) : null;
  };
  const u32 = (id: number): number | null => {
    const p = byId.get(id);
    return p ? p.value.readUInt32LE(0) : null;
  };

  const event = u16(0x40) ?? 0;
  // Coordinates: 4-byte LE, scaled 1e-6 (protocol examples).
  const lngRaw = u32(0x02);
  const latRaw = u32(0x03);
  const speed = u16(0x08) ?? 0;
  const heading = u16(0x09) ?? 0;
  const timeRaw = u32(0x04);
  // GPS time = seconds since 2000-01-01.
  const timestamp =
    timeRaw !== null ? new Date(Date.UTC(2000, 0, 1) + timeRaw * 1000) : new Date(raw.receivedAt);

  const hasFix = latRaw !== null && lngRaw !== null;
  const position: Position | undefined = hasFix
    ? {
        latitude: (latRaw ?? 0) / 1e6,
        longitude: (lngRaw ?? 0) / 1e6,
        speedKph: speed,
        headingDeg: heading,
        altitudeM: null,
        satellites: null,
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
        ignitionOn: true,
      }
    : undefined;

  const messages: DeviceMessage[] = [];
  if (event !== 0) {
    let alarm = mapMeitrackEvent(event);
    let detail: Record<string, unknown> | undefined;
    const fe31 = byId.get(0xfe31);
    if (event === 126 && fe31) {
      const dms = parseDmsDetail(fe31.value);
      if (dms) {
        const mapped = mapDmsAlarmType(dms.protocol, dms.alarmType);
        alarm = { code: mapped.code, source: String(event), severity: mapped.severity };
        detail = {
          dmsProtocol: dms.protocol,
          dmsAlarmType: dms.alarmType,
          dmsDetail: mapped.detail,
          photoName: dms.photoName,
        };
      }
    }
    messages.push(
      message(raw, {
        type: 'ALARM',
        serialOrImei: imei,
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
        position,
        alarms: [alarm],
        telemetry: detail,
      }),
    );
  } else if (position) {
    messages.push(
      message(raw, {
        type: 'POSITION',
        serialOrImei: imei,
        timestamp: position.timestamp,
        position,
      }),
    );
  }
  if (messages.length === 0) {
    throw new ProtocolError('CCE frame carried neither an event nor a position.', 'meitrack');
  }
  return messages;
}

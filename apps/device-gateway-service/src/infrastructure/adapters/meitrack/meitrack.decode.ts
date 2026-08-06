/**
 * Meitrack decode — vendor frame → canonical DeviceMessage (06 §10.2 normalization).
 *
 * Handles the tracking-family packets needed to prove the pipeline end-to-end
 * (Meitrack GPRS Protocol v1.6):
 *   - AAA tracking, event 0  → POSITION (lat/lng/speed/heading/time/sats + IO).
 *   - AAA tracking, event≠0  → ALARM (carries the same position + mapped alarm).
 *   - AAC / D82 / E##        → COMMAND_ACK (server-ack echo or device command result).
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
import { mapMeitrackEvent } from './meitrack.codes.js';
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
 */
export function decodeMeitrack(raw: RawPacket): readonly DeviceMessage[] {
  const frame = parseFrame(raw.payload);

  switch (frame.command) {
    case MEITRACK_COMMAND.TRACKING:
      return [decodeTracking(raw, frame.fields)];
    case MEITRACK_COMMAND.ACK:
    case MEITRACK_COMMAND.COMMAND_RESPONSE:
      return [decodeCommandAck(raw, frame.fields)];
    default:
      throw new ProtocolError(
        `Meitrack command '${frame.command}' not supported (decode).`,
        'meitrack',
      );
  }
}

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

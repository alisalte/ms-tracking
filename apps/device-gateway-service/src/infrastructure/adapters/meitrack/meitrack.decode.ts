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
import { snapshotCce } from './meitrack.cce-snapshot.js';
import { mapDmsAlarmType, mapMeitrackEvent } from './meitrack.codes.js';
import { buildMeitrackFrame } from './meitrack.encode.js';
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
  // Binary bodies (CCE / CFF cache / AB8) must be detected before comma-splitting.
  if (binaryEventCommand(raw.payload)) {
    return decodeCce(raw);
  }
  if (isAb8Reply(raw.payload)) {
    return [decodeAb8(raw)];
  }

  const frame = parseFrame(raw.payload);

  switch (frame.command) {
    case MEITRACK_COMMAND.TRACKING:
      return decodeTracking(raw, frame.fields);
    case 'D00':
      // Photo chunk (D00 download response) — hex payload, always text-safe.
      return [decodePhotoChunk(raw, frame.fields)];
    case 'D01':
      // Photo filename listing (D01 response).
      return [decodePhotoList(raw, frame.fields)];
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

/**
 * Periodic / keepalive / A10-reply event codes — not operator alarms
 * (GPRS V2.0 §1.3 / §3.1–§3.2).
 *
 * 33 = Track By Distance, 35 = Track By Time Interval — devices emit these
 * constantly as location reports; raising them as alarms floods the center
 * with "Device event 33/35" noise.
 */
const MEITRACK_TRACK_EVENTS = new Set([0, 31, 33, 34, 35]);
/** Live CCE/A10: if the GPS clock is this far off, stamp the packet with receive time. */
const GPS_CLOCK_SKEW_MS = 5 * 60_000;

function stampIfSkewed(gpsTs: Date, receivedAt: Date): Date {
  if (Number.isNaN(gpsTs.getTime())) return new Date(receivedAt);
  if (Math.abs(gpsTs.getTime() - receivedAt.getTime()) > GPS_CLOCK_SKEW_MS) {
    return new Date(receivedAt);
  }
  return gpsTs;
}

/** Decode an AAA tracking packet → POSITION (event 0) or ALARM (event≠0). */
function decodeTracking(raw: RawPacket, fields: readonly string[]): DeviceMessage[] {
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

  const gpsOk = (fields[6] ?? 'V') === 'A';
  // Event 31 = GPRS heartbeat: protocol says GPS in that packet is invalid.
  // Event 34 = A10 on-demand location — record the reported fix even if the
  // validity flag is V (last-known coords); that is the locate-now reply.
  let pos = event === 31 || (!gpsOk && event !== 34) ? undefined : parsePosition(fields);
  if (pos && event === 34) {
    pos = { ...pos, timestamp: stampIfSkewed(pos.timestamp, raw.receivedAt) };
  }
  const isAlarm = !MEITRACK_TRACK_EVENTS.has(event);
  const io = parseIo(fields);
  const messages: DeviceMessage[] = [];

  if (event === 34) {
    messages.push(
      message(raw, {
        type: 'COMMAND_ACK',
        serialOrImei: imei,
        timestamp: pos?.timestamp ?? raw.receivedAt,
        telemetry: { command: 'A10', response: 'OK' },
      }),
    );
  }

  if (isAlarm) {
    messages.push(
      message(raw, {
        type: 'ALARM',
        serialOrImei: imei,
        timestamp: pos?.timestamp ?? raw.receivedAt,
        position: pos,
        alarms: [mapMeitrackEvent(event)],
        telemetry: {
          ignitionOn: pos?.ignitionOn,
          hdop: io.hdop,
          odometerKm: io.odometerKm,
          batteryVoltage: io.batteryVoltage,
          powerVoltage: io.powerVoltage,
        },
        io: io.raw,
      }),
    );
  }

  if (pos && event !== 31) {
    messages.push(
      message(raw, {
        type: 'POSITION',
        serialOrImei: imei,
        timestamp: pos.timestamp,
        position: pos,
        telemetry: {
          ignitionOn: pos.ignitionOn,
          hdop: io.hdop,
          odometerKm: io.odometerKm,
          batteryVoltage: io.batteryVoltage,
          powerVoltage: io.powerVoltage,
        },
        io: io.raw,
      }),
    );
  }

  if (messages.length === 0) {
    messages.push(
      message(raw, {
        type: 'TELEMETRY',
        serialOrImei: imei,
        timestamp: raw.receivedAt,
        telemetry: { command: 'AAA', event },
        io: io.raw,
      }),
    );
  }
  return messages;
}

/**
 * Decode a D00 photo-download response → one PHOTO chunk message:
 *   <imei>,D00,<filename>,<totalPackets>,<packetIndex>,<hexdata>
 *
 * `hexdata` is ASCII hex (no raw bytes), so it survives the text/comma-split
 * path unlike CCE bodies. Chunks arrive in any order the device chooses; a
 * consumer reassembles the full image with PhotoAssembler
 * (meitrack.photo-assembler.ts) keyed on (imei, filename), sorted by
 * packetIndex — see md300/server/capture_photo.py, the validated reference.
 */
function decodePhotoChunk(raw: RawPacket, fields: readonly string[]): DeviceMessage {
  const imei = fields[0] ?? '';
  const filename = fields[2] ?? '';
  const totalPackets = Number.parseInt(fields[3] ?? '', 10) || 0;
  const packetIndex = Number.parseInt(fields[4] ?? '', 10) || 0;
  const hexData = fields[5] ?? '';
  let chunkBase64 = '';
  try {
    chunkBase64 = hexData ? Buffer.from(hexData, 'hex').toString('base64') : '';
  } catch {
    chunkBase64 = '';
  }
  return message(raw, {
    type: 'PHOTO',
    serialOrImei: imei,
    timestamp: raw.receivedAt,
    telemetry: {
      command: 'D00',
      filename,
      totalPackets,
      packetIndex,
      chunkBase64,
      chunkBytes: hexData.length / 2,
    },
  });
}

/**
 * Decode a D01 photo-listing response → COMMAND_ACK carrying the parsed names:
 *   <imei>,D01,<totalPackets>,<packetIndex>,name1|name2|...|
 */
function decodePhotoList(raw: RawPacket, fields: readonly string[]): DeviceMessage {
  const imei = fields[0] ?? '';
  const totalPackets = Number.parseInt(fields[2] ?? '', 10) || 0;
  const packetIndex = Number.parseInt(fields[3] ?? '', 10) || 0;
  const namesField = fields.slice(4).join(',');
  const photoNames = namesField
    .split('|')
    .map((n) => n.trim())
    .filter(Boolean);
  return message(raw, {
    type: 'COMMAND_ACK',
    serialOrImei: imei,
    timestamp: raw.receivedAt,
    telemetry: { command: 'D01', totalPackets, packetIndex, photoNames },
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

/** Detect `$$…,<imei>,AB8,` frames (the AB8 body is binary — never comma-split). */
function isAb8Reply(payload: Buffer): boolean {
  const head = payload.subarray(0, Math.min(payload.length, 80)).toString('binary');
  const firstComma = head.indexOf(',');
  const secondComma = head.indexOf(',', firstComma + 1);
  const thirdComma = head.indexOf(',', secondComma + 1);
  if (firstComma === -1 || secondComma === -1 || thirdComma === -1) return false;
  if (head.substring(secondComma + 1, thirdComma) !== 'AB8') return false;
  const star = payload.lastIndexOf(0x2a);
  if (star < 0) return false;
  const body = payload.subarray(thirdComma + 1, star);
  if (body.length >= 2 && body[0] === 0x4f && body[1] === 0x4b) return false; // ASCII AB8,OK
  return body.length >= 12;
}

const AB8_FILE_BYTES = 30;

function bcd6ToDigits(buf: Buffer, offset: number): string {
  return buf.subarray(offset, offset + 6).toString('hex');
}

/**
 * Decode an AB8 resource-list reply (MDVR GPRS Protocol V2.0 §3.31).
 * Header (12B LE) + ReplyMsg_t[Number] (30B each).
 */
function decodeAb8(raw: RawPacket): DeviceMessage {
  const starIdx = raw.payload.lastIndexOf(0x2a);
  if (starIdx < 0) {
    throw new ProtocolError('AB8 frame missing checksum separator.', 'meitrack');
  }
  let off = raw.payload.indexOf(0x2c) + 1;
  const imeiEnd = raw.payload.indexOf(0x2c, off);
  const imei = raw.payload.subarray(off, imeiEnd).toString('ascii');
  off = raw.payload.indexOf(0x2c, imeiEnd + 1) + 1;
  const body = raw.payload.subarray(off, starIdx);
  if (body.length < 12) {
    throw new ProtocolError('AB8 reply shorter than the packet header.', 'meitrack');
  }
  const allPack = body.readUInt16LE(0);
  const curPack = body.readUInt16LE(2);
  const allFileNum = body.readUInt32LE(4);
  const count = Math.min(body.readUInt32LE(8), 500);
  const resources: Array<Record<string, number | string>> = [];
  let cursor = 12;
  for (let i = 0; i < count && cursor + AB8_FILE_BYTES <= body.length; i++) {
    const rec = body.subarray(cursor, cursor + AB8_FILE_BYTES);
    resources.push({
      channel: rec[0] ?? 0,
      startTime: bcd6ToDigits(rec, 1),
      endTime: bcd6ToDigits(rec, 7),
      eventCode: rec.readUInt16LE(19),
      subEventCode: rec.readUInt16LE(21),
      avType: rec[23] ?? 0,
      streamType: rec[24] ?? 0,
      capType: rec[25] ?? 0,
      fileLen: rec.readUInt32LE(26),
    });
    cursor += AB8_FILE_BYTES;
  }
  return message(raw, {
    type: 'COMMAND_ACK',
    serialOrImei: imei,
    timestamp: raw.receivedAt,
    telemetry: {
      command: 'AB8',
      response: 'OK',
      allPack,
      curPack,
      allFileNum,
      resources,
    },
  });
}

// ── CCE (MDVR binary telemetry/alarm frame, MDVR GPRS Protocol V2.0 §2) ──────

/**
 * `$$…,<imei>,CCE,` is always a binary event body.
 * `$$…,<imei>,CFF,` is the same body when the device answers a cache pull
 * (`CFF,<CCE data>`); a short text reply such as `CFF,OK` stays a command ACK.
 */
function binaryEventCommand(payload: Buffer): 'CCE' | 'CFF' | null {
  const head = payload.subarray(0, Math.min(payload.length, 80));
  const firstComma = head.indexOf(0x2c);
  const secondComma = firstComma === -1 ? -1 : head.indexOf(0x2c, firstComma + 1);
  const thirdComma = secondComma === -1 ? -1 : head.indexOf(0x2c, secondComma + 1);
  if (firstComma === -1 || secondComma === -1 || thirdComma === -1) return null;
  const cmd = head.subarray(secondComma + 1, thirdComma).toString('ascii');
  if (cmd === 'CCE') return 'CCE';
  if (cmd !== 'CFF') return null;
  const star = payload.lastIndexOf(0x2a);
  if (star <= thirdComma) return null;
  const body = payload.subarray(thirdComma + 1, star);
  if (body.length < 10) return null;
  for (let i = 0; i < Math.min(body.length, 8); i++) {
    const b = body[i] ?? 0;
    if (b === 0 || b > 0x7e) return 'CFF';
  }
  return null;
}

/** One decoded CCE parameter. */
interface CceParam {
  readonly id: number;
  readonly value: Buffer;
}

/**
 * MDVR CCE body starts with a cache/packet envelope (MDVR GPRS Protocol V2.0):
 *   uint32 LE remaining cache records
 *   uint16 LE number of packets in this frame
 * then per packet:
 *   uint16 LE packet length, uint16 LE id-count,
 *   1-byte param group, 2-byte group, 4-byte group, n-byte group.
 *
 * Older unit tests (and some trackers) omit the envelope and 1-byte group.
 *
 * Do NOT require cache-remaining < 256 (old check on bytes 1–3 == 0): MD300s
 * with a backlog silently failed envelope detection, so event-126 DMS/ADAS
 * never decoded and never reached Kafka.
 */
function hasCceEnvelope(buf: Buffer): boolean {
  if (buf.length < 10) return false;
  const nPkts = buf.readUInt16LE(4);
  if (nPkts < 1 || nPkts > 64) return false;
  const pktLen = buf.readUInt16LE(6);
  // Length is the byte count AFTER the uint16 length field (id-count + groups).
  // The first packet must fit: offset 6 + 2 + pktLen.
  return pktLen >= 4 && 8 + pktLen <= buf.length;
}

/**
 * One CCE upload is a list of records (MDVR GPRS Protocol V2.0 §1.2). MD300s
 * flush a DMS/ADAS event (code 126) in the same frame as later periodic tracks
 * (code 35). Merging every record into one map kept only the last event code,
 * so the driver alarm never became an ALARM and never reached the alarm center.
 */
function parseCcePackets(buf: Buffer): CceParam[][] {
  if (hasCceEnvelope(buf)) {
    const packets = parseEnvelopedCce(buf);
    // Trust the envelope only when it yields a real event code (0x40) — otherwise
    // fall through to the legacy non-enveloped layout used by some trackers/tests.
    if (packets.some((params) => params.some((p) => p.id === 0x40))) return packets;
  }
  return [parseCceGroups(buf, 0, buf.length, false)];
}

function parseEnvelopedCce(buf: Buffer): CceParam[][] {
  const packets: CceParam[][] = [];
  const nPkts = buf.readUInt16LE(4);
  let off = 6;
  for (let p = 0; p < nPkts && off + 4 <= buf.length; p++) {
    // MDVR GPRS Protocol V2.0 / Traccar decodeBinaryE: the uint16 length counts
    // the bytes AFTER itself (2-byte id-count + parameter groups). Treating it
    // as including the length field ends the record 2 bytes early and desyncs
    // every following record — a later event 126 never becomes an alarm.
    const pktLen = buf.readUInt16LE(off);
    off += 2;
    const pktEnd = Math.min(buf.length, off + pktLen);
    if (pktEnd < off + 2) break;
    off += 2; // id-count (informational)
    packets.push(parseCceGroups(buf, off, pktEnd, true));
    off = pktEnd;
  }
  return packets;
}

/**
 * Parameter groups inside one CCE packet.
 * `withOneByteGroup` is the MDVR wire order (1-byte IDs, then 2, 4, n).
 */
function parseCceGroups(
  buf: Buffer,
  start: number,
  end: number,
  withOneByteGroup: boolean,
): CceParam[] {
  const params: CceParam[] = [];
  let off = start;
  const remaining = () => end - off;
  const readU8 = (): number => {
    if (off >= end) return 0;
    return buf[off++] ?? 0;
  };
  const readU16 = (): number => {
    if (remaining() < 2) {
      off = end;
      return 0;
    }
    const v = buf.readUInt16LE(off);
    off += 2;
    return v;
  };
  const readU32 = (): number => {
    if (remaining() < 4) {
      off = end;
      return 0;
    }
    const v = buf.readUInt32LE(off);
    off += 4;
    return v;
  };
  // 0xFE is the documented extension (0xFE30 / 0xFE2F add one ID byte).
  // 0xF8 is the high byte of CAN IDs 0xF825 / 0xF826 / 0xF827.
  const readExtendedId = (): number => {
    let id = readU8();
    if ((id === 0xfe || id === 0xf8) && remaining() > 0) {
      id = ((id << 8) | readU8()) & 0xffff;
    }
    return id;
  };

  if (withOneByteGroup) {
    const n1 = readU8();
    for (let i = 0; i < n1 && remaining() >= 2; i++) {
      const id = readU8();
      const v = readU8();
      params.push({ id, value: Buffer.from([v]) });
    }
  }

  const n2 = readU8();
  for (let i = 0; i < n2 && remaining() >= 3; i++) {
    const id = readExtendedId();
    if (remaining() < 2) break;
    const v = readU16();
    params.push({ id, value: Buffer.from([v & 0xff, (v >> 8) & 0xff]) });
  }
  const n4 = readU8();
  for (let i = 0; i < n4 && remaining() >= 5; i++) {
    const id = readExtendedId();
    if (remaining() < 4) break;
    const v = readU32();
    params.push({
      id,
      value: Buffer.from([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]),
    });
  }
  const nn = readU8();
  for (let i = 0; i < nn && remaining() > 0; i++) {
    const id = readExtendedId();
    const len = remaining() > 0 ? readU8() : 0;
    const take = Math.min(len, remaining());
    const value = buf.subarray(off, off + take);
    off += take;
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

/**
 * Some fixtures prefix `<ID_Len><protocol><type>…` where ID_Len counts the
 * bytes after itself. The device value does not: the n-byte group length is
 * already consumed, and the value starts at AlarmProtocol (PDF example
 * `02 07` + photo, Traccar `0xFE31`).
 */
function isLegacyDmsIdLen(value: Buffer): boolean {
  if (value.length < 4) return false;
  const idLen = value[0] ?? 0;
  const protocol = value[1] ?? 0;
  return idLen === value.length - 1 && idLen >= 3 && protocol >= 1 && protocol <= 4;
}

function parseDmsDetail(value: Buffer): DmsDetail | null {
  if (value.length < 2) return null;
  const legacy = isLegacyDmsIdLen(value);
  const protocol = legacy ? (value[1] ?? 0) : (value[0] ?? 0);
  const alarmType = legacy ? (value[2] ?? 0) : (value[1] ?? 0);
  let photoName: string | null = null;
  const nameBytes = value.subarray(legacy ? 3 : 2);
  const zero = nameBytes.indexOf(0);
  const slice = zero >= 0 ? nameBytes.subarray(0, zero) : nameBytes;
  if (slice.length > 0) {
    // Trailing NUL padding is dropped at the byte level (no control chars in regex).
    let end = slice.length;
    while (end > 0 && slice[end - 1] === 0) end--;
    photoName = slice.subarray(0, end).toString('ascii') || null;
  }
  return { protocol, alarmType, photoName };
}

/**
 * Decode a CCE frame → POSITION and/or ALARM message(s). The event code rides
 * parameter 0x40 (2-byte LE). DMS/ADAS detail is 0xFE31 on event 126 and, on
 * this MD300, on events 655–663.
 * Each inner record is decoded on its own so an earlier driver alarm is not
 * overwritten by a later track record in the same upload.
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

  let packets: CceParam[][] = [];
  try {
    packets = parseCcePackets(body);
  } catch {
    packets = [];
  }
  const cacheRemaining = hasCceEnvelope(body) ? body.readUInt32LE(0) : 0;
  const livePacket = cacheRemaining === 0;
  const messages: DeviceMessage[] = [];
  for (const params of packets) {
    messages.push(...messagesFromCcePacket(raw, imei, params, livePacket));
  }
  if (messages.length === 0) {
    // MD300 keepalives are CCE with IMEI but no GPS yet. Still authenticate
    // so held AB2/AB3 can flush onto the GPRS socket.
    messages.push(
      message(raw, {
        type: 'TELEMETRY',
        serialOrImei: imei,
        timestamp: new Date(raw.receivedAt),
        telemetry: { command: 'CCE' },
      }),
    );
  }
  return messages;
}

/** One inner CCE record → ALARM and/or POSITION. No keepalive fallback. */
function messagesFromCcePacket(
  raw: RawPacket,
  imei: string,
  params: readonly CceParam[],
  livePacket: boolean,
): DeviceMessage[] {
  const byId = new Map<number, CceParam>();
  for (const p of params) byId.set(p.id, p);

  const u8 = (id: number): number | null => {
    const p = byId.get(id);
    return p && p.value.length >= 1 ? (p.value[0] ?? null) : null;
  };
  const u16 = (id: number): number | null => {
    const p = byId.get(id);
    if (!p) return null;
    if (p.value.length >= 2) return p.value.readUInt16LE(0);
    if (p.value.length === 1) return p.value[0] ?? null;
    return null;
  };
  const u32 = (id: number): number | null => {
    const p = byId.get(id);
    return p && p.value.length >= 4 ? p.value.readUInt32LE(0) : null;
  };

  const i32 = (id: number): number | null => {
    const p = byId.get(id);
    return p && p.value.length >= 4 ? p.value.readInt32LE(0) : null;
  };

  const event = u16(0x40) ?? u8(0x01) ?? 0;
  // CCE 4-byte GPS IDs per MEITRACK MDVR GPRS Protocol V2.0 §"Parameter list"
  // (and matching the AAA text protocol's lat-before-lng field order):
  // 0x02 = latitude, 0x03 = longitude (signed millionths of a degree).
  // Confirmed against a real MD300 capture (IMEI 867191086416152): the same
  // frame's 0x0E base-station field decodes to MCC 432 / MNC 35 (Iran,
  // Irancell) — only the 0x02=lat/0x03=lng assignment places the fix inside
  // Iran; the previously swapped mapping placed it on the Black Sea coast.
  const latRaw = i32(0x02);
  const lngRaw = i32(0x03);
  const speed = u16(0x08) ?? 0;
  const heading = u16(0x09) ?? 0;
  const timeRaw = u32(0x04);
  const gpsFlag = u8(0x05);
  // 0x05: 0 = invalid, 1 = valid. Missing (older frames / unit tests) → trust coords.
  // Event 31 is a GPRS heartbeat — GPS in that packet is defined invalid.
  const gpsValid = event !== 31 && gpsFlag !== 0;
  // GPS time = seconds since 2000-01-01. Live packets with a skewed GPS clock
  // must use receive time so gps-engine does not tag them STALE and drop them
  // from the live map.
  const gpsTimestamp =
    timeRaw !== null ? new Date(Date.UTC(2000, 0, 1) + timeRaw * 1000) : new Date(raw.receivedAt);
  const timestamp = livePacket
    ? stampIfSkewed(
        Number.isNaN(gpsTimestamp.getTime()) ? new Date(raw.receivedAt) : gpsTimestamp,
        raw.receivedAt,
      )
    : gpsTimestamp;

  const latitude = (latRaw ?? 0) / 1e6;
  const longitude = (lngRaw ?? 0) / 1e6;
  const inRange =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
  const coordsOk = latRaw !== null && lngRaw !== null && !(latRaw === 0 && lngRaw === 0) && inRange;
  // A10 (event 34) always records an in-range fix so locate-now lands on the map.
  const hasFix = coordsOk && (gpsValid || event === 34);
  const cce = snapshotCce(params);
  const position: Position | undefined = hasFix
    ? {
        latitude,
        longitude,
        speedKph: speed,
        headingDeg: heading,
        altitudeM: cce.status.altitudeM ?? null,
        satellites: u8(0x06),
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
        // Not taken from input 1: it is unverified on MD300 wiring. The raw
        // input bits are in cce.status.inputs.
        ignitionOn: true,
      }
    : undefined;

  const withCce = (extra?: Record<string, unknown>): Record<string, unknown> =>
    extra ? { ...extra, cce } : { cce };
  const messages: DeviceMessage[] = [];
  if (event === 34) {
    messages.push(
      message(raw, {
        type: 'COMMAND_ACK',
        serialOrImei: imei,
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
        telemetry: withCce({ command: 'A10', response: 'OK' }),
      }),
    );
  }
  if (!MEITRACK_TRACK_EVENTS.has(event)) {
    let alarm = mapMeitrackEvent(event);
    let detail: Record<string, unknown> | undefined;
    // 0xFE31 is the documented DMS/ADAS detail; some firmware also uses 0xFE2D.
    // This MD300 attaches it to events 655–663 (not 126). Any event that
    // carries a protocol 1–4 detail is a driver alarm.
    const fe31 = byId.get(0xfe31) ?? byId.get(0xfe2d);
    if (fe31) {
      const dms = parseDmsDetail(fe31.value);
      if (dms && dms.protocol >= 1 && dms.protocol <= 4) {
        const mapped = mapDmsAlarmType(dms.protocol, dms.alarmType, dms.photoName);
        alarm = { code: mapped.code, source: String(event), severity: mapped.severity };
        detail = {
          dmsProtocol: dms.protocol,
          dmsAlarmType: dms.alarmType,
          dmsDetail: mapped.detail,
          photoName: dms.photoName,
          deviceEvent: event,
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
        telemetry: withCce(detail),
      }),
    );
  }
  if (position) {
    messages.push(
      message(raw, {
        type: 'POSITION',
        serialOrImei: imei,
        timestamp: position.timestamp,
        position,
        telemetry: withCce(),
      }),
    );
  }
  // Heartbeats and invalid fixes are not map positions. Still publish the full
  // parameter map so a CAN-less packet is recorded as can=absent, not dropped.
  if (messages.length === 0) {
    messages.push(
      message(raw, {
        type: 'TELEMETRY',
        serialOrImei: imei,
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date(raw.receivedAt) : timestamp,
        telemetry: withCce({ command: 'CCE' }),
      }),
    );
  }
  return messages;
}

/**
 * Confirm a cached MDVR upload so the device deletes it and sends the next
 * record (MDVR GPRS Protocol V2.0 §3.64 CFF). The reply data ID must match the
 * inbound frame or the unit ignores the delete and the buffer head never
 * advances — a stuck track record then hides every later driver alarm.
 *
 * Live CCE (cache remaining 0) is not confirmed. A CFF body is itself buffered
 * data and is always confirmed, including the last record.
 */
export function buildCceCacheAck(payload: Buffer): Buffer | null {
  const kind = binaryEventCommand(payload);
  if (!kind || payload.length < 3 || payload[0] !== 0x24 || payload[1] !== 0x24) return null;
  const dataId = String.fromCharCode(payload[2] ?? 0);
  if (!/^[A-Za-z0-9]$/.test(dataId)) return null;

  const starIdx = payload.lastIndexOf(0x2a);
  const firstComma = payload.indexOf(0x2c);
  if (starIdx < 0 || firstComma < 0) return null;
  const imeiEnd = payload.indexOf(0x2c, firstComma + 1);
  if (imeiEnd < 0) return null;
  const imei = payload.subarray(firstComma + 1, imeiEnd).toString('ascii');
  if (!/^\d{10,17}$/.test(imei)) return null;
  const bodyStart = payload.indexOf(0x2c, imeiEnd + 1);
  if (bodyStart < 0 || bodyStart >= starIdx) return null;
  const body = payload.subarray(bodyStart + 1, starIdx);
  if (!hasCceEnvelope(body)) return null;
  const cacheRemaining = body.readUInt32LE(0);
  if (kind === 'CCE' && cacheRemaining === 0) return null;
  let packets: CceParam[][] = [];
  try {
    packets = parseCcePackets(body);
  } catch {
    return null;
  }
  // Delete only records we actually decoded. A bad length must not drop unread cache.
  const parsed = packets.filter((params) => params.some((p) => p.id === 0x40)).length;
  if (parsed < 1 || parsed > 64) return null;
  // Quantity is hexadecimal (the documented example `CFF,1` is one record).
  const qty = parsed.toString(16).toUpperCase();
  return buildMeitrackFrame(`${imei},CFF,${qty}`, dataId);
}

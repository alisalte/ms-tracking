/**
 * JT808 decode — unstuffed vendor frame → canonical DeviceMessage
 * (06 §10.2 normalization; JT/T 808-2019).
 *
 * Handles the message types needed to prove the pipeline end-to-end:
 *   - 0x0100 Register       → LOGIN (permissive model: registration authenticates
 *                             the session — see 06 §7 + adapter doc). The device
 *                             phone (BCD) is the serialOrImei on every message,
 *                             so the dispatcher's implicit-login path authenticates
 *                             off the first packet.
 *   - 0x0200 Location       → POSITION (alarm-flag == 0) | ALARM (alarm bits set),
 *                             with the full position block + IO TLV items.
 *   - 0x0301 Event Report   → ALARM (event-id byte).
 *   - 0x0002 Heartbeat      → HEARTBEAT.
 *   - 0x0001 Term General Response → COMMAND_ACK.
 *
 * 0x0200 position body layout (verified against the reference decoder):
 *   alarmFlag(4) status(4) lat(4) lng(4) altitude(2,signed) speed(2,/10) dir(2)
 *   time(BCD 6, YYMMDDhhmmss) [TLV IO items]
 *   lat/lng are unsigned /1e6; sign comes from status bit2 (S) / bit3 (W).
 *   Default device timezone is GMT+8 (per spec); we interpret the BCD clock as
 *   device-local and report the wall-clock instant.
 */
import { createHash } from 'node:crypto';
import { DeviceMessage, type Position } from '../../../domain/device-message.js';
import { ProtocolError } from '../../../domain/errors.js';
import type { RawPacket } from '../../../domain/raw-packet.js';
import { IO_ID, STATUS_BIT, decodeAlarmFlag, decodeEventId } from './jt808.codes.js';
import { MSG, bodyOf, parseHeader } from './jt808.header.js';

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
    protocolId: 'jt808',
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
 * Decode a JT808 RawPacket into one DeviceMessage. Throws ProtocolError on an
 * unsupported/undersized frame so the dispatcher drops it and bumps `decode.error`
 * (06 §8). Encryption ≠ 0 is unsupported (out of scope — see adapter doc).
 */
export function decodeJt808(raw: RawPacket): readonly DeviceMessage[] {
  const frame = raw.payload;
  const header = parseHeader(frame);
  if (header.encryption !== 0) {
    throw new ProtocolError(
      `JT808 encrypted body (enc=${header.encryption}) not supported.`,
      'jt808',
    );
  }
  const body = bodyOf(frame, header);
  const phone = header.phone;

  switch (header.msgId) {
    case MSG.REGISTER:
      return [decodeRegister(raw, phone, body)];

    case MSG.LOCATION:
      return [decodeLocation(raw, phone, body)];

    case MSG.EVENT_REPORT:
      return [decodeEvent(raw, phone, body)];

    case MSG.HEARTBEAT:
      return [
        message(raw, {
          type: 'HEARTBEAT',
          serialOrImei: phone,
          timestamp: raw.receivedAt,
        }),
      ];

    case MSG.TERMINAL_GENERAL_RESPONSE:
      return [decodeGeneralResponse(raw, phone, body)];

    // 0x0102 auth, 0x0201 query-response, 0x0000 etc. are accepted-but-unsupported
    // uplink types for this sprint; reject so decode.error is bumped cleanly.
    default:
      throw new ProtocolError(
        `JT808 message id 0x${header.msgId.toString(16).padStart(4, '0')} not supported (decode).`,
        'jt808',
      );
  }
}

/** 0x0100 Register → LOGIN. Stashes the registration body fields in telemetry. */
function decodeRegister(raw: RawPacket, phone: string, body: Buffer): DeviceMessage {
  // Body: provinceId(2) cityId(2) manufacturerId(5|11) model(20|30) terminalId(7|30)
  //       plateColor(1) plate(string). We surface a representative subset.
  const telemetry: Record<string, unknown> = {};
  if (body.length >= 4) {
    telemetry.provinceId = body.readUInt16BE(0);
    telemetry.cityId = body.readUInt16BE(2);
  }
  if (body.length >= 9) {
    telemetry.manufacturerId = body.subarray(4, 9).toString('ascii');
  }
  return message(raw, {
    type: 'LOGIN',
    serialOrImei: phone,
    timestamp: raw.receivedAt,
    telemetry,
  });
}

/** 0x0200 Location → POSITION (no alarm) or ALARM (alarm bits set). */
function decodeLocation(raw: RawPacket, phone: string, body: Buffer): DeviceMessage {
  if (body.length < 28) {
    throw new ProtocolError(`JT808 0x0200 body too short (${body.length} bytes).`, 'jt808');
  }
  // JS bitwise ops are 32-bit signed; read the DWORDs as unsigned then >>> 0.
  const alarmFlag = body.readUInt32BE(0) >>> 0;
  const status = body.readUInt32BE(4) >>> 0;
  const latRaw = body.readUInt32BE(8);
  const lngRaw = body.readUInt32BE(12);
  const altitude = body.readInt16BE(16); // signed meters
  const speedRaw = body.readUInt16BE(18); // /10 km/h
  const direction = body.readUInt16BE(20); // degrees
  const time = readBcdTime(body.subarray(22, 28));

  const valid = (status & (1 << STATUS_BIT.FIX_VALID)) !== 0;
  const ignitionOn = (status & (1 << STATUS_BIT.ACC)) !== 0;
  let latitude = latRaw / 1_000_000;
  let longitude = lngRaw / 1_000_000;
  if ((status & (1 << STATUS_BIT.LAT_SOUTH)) !== 0) latitude = -latitude;
  if ((status & (1 << STATUS_BIT.LNG_WEST)) !== 0) longitude = -longitude;

  // Optional TLV IO items after the 28-byte fixed block.
  const io = parseIoItems(body.subarray(28));
  const satellites =
    typeof io.raw[IO_ID.SATELLITES] === 'number' ? (io.raw[IO_ID.SATELLITES] as number) : null;

  const position: Position = {
    latitude,
    longitude,
    speedKph: valid ? speedRaw / 10 : 0,
    headingDeg: direction,
    altitudeM: altitude,
    satellites,
    timestamp: time,
    ignitionOn,
  };

  const alarms = decodeAlarmFlag(alarmFlag);
  const type = alarms.length > 0 ? 'ALARM' : 'POSITION';

  return message(raw, {
    type,
    serialOrImei: phone,
    timestamp: time,
    position,
    alarms: alarms.length > 0 ? alarms : undefined,
    telemetry: {
      alarmFlag,
      status,
      ignitionOn,
      valid,
      odometerKm: io.odometerKm,
      fuel: io.fuel,
    },
    io: io.raw,
  });
}

/** 0x0301 Event Report → ALARM (body = single event-id byte). */
function decodeEvent(raw: RawPacket, phone: string, body: Buffer): DeviceMessage {
  if (body.length < 1) {
    throw new ProtocolError('JT808 0x0301 event report has no event id.', 'jt808');
  }
  const eventId = body[0] ?? 0;
  return message(raw, {
    type: 'ALARM',
    serialOrImei: phone,
    timestamp: raw.receivedAt,
    alarms: [decodeEventId(eventId)],
    telemetry: { eventId },
  });
}

/** 0x0001 Terminal General Response → COMMAND_ACK. */
function decodeGeneralResponse(raw: RawPacket, phone: string, body: Buffer): DeviceMessage {
  if (body.length < 5) {
    throw new ProtocolError(
      `JT808 0x0001 general response too short (${body.length} bytes).`,
      'jt808',
    );
  }
  const seq = body.readUInt16BE(0);
  const id = body.readUInt16BE(2);
  const result = body[4] ?? 0;
  return message(raw, {
    type: 'COMMAND_ACK',
    serialOrImei: phone,
    timestamp: raw.receivedAt,
    telemetry: { seq, ackedMessageId: `0x${id.toString(16).padStart(4, '0')}`, result },
  });
}

/** Parse the variable-length TLV IO extension after the 0x0200 fixed block. */
function parseIoItems(buf: Buffer): {
  odometerKm: number | null;
  fuel: number | null;
  raw: Record<string, unknown>;
} {
  const raw: Record<string, unknown> = {};
  let odometerKm: number | null = null;
  let fuel: number | null = null;
  let off = 0;
  while (off + 2 <= buf.length) {
    const id = buf[off] ?? 0;
    const len = buf[off + 1] ?? 0;
    off += 2;
    if (off + len > buf.length) break; // truncated tail — stop
    const valBuf = buf.subarray(off, off + len);
    off += len;
    switch (id) {
      case IO_ID.MILEAGE:
        if (len >= 4) {
          odometerKm = (valBuf.readUInt32BE(0) ?? 0) / 10; // 0.1 km → km
          raw[id] = odometerKm;
        }
        break;
      case IO_ID.FUEL:
        if (len >= 2) {
          fuel = (valBuf.readUInt16BE(0) ?? 0) / 10;
          raw[id] = fuel;
        }
        break;
      case IO_ID.RSSI:
      case IO_ID.SATELLITES:
        raw[id] = len >= 1 ? (valBuf[0] ?? 0) : 0;
        break;
      default:
        raw[id] = valBuf.toString('hex');
    }
  }
  return { odometerKm, fuel, raw };
}

/** Read BCD[6] YYMMDDhhmmss (device-local clock) → Date (UTC interpretation). */
function readBcdTime(buf: Buffer): Date {
  if (buf.length < 6) return new Date();
  const yy = bcd(buf[0]);
  const mm = bcd(buf[1]);
  const dd = bcd(buf[2]);
  const hh = bcd(buf[3]);
  const mi = bcd(buf[4]);
  const ss = bcd(buf[5]);
  // The spec defines the clock in device-local time (default GMT+8). We cannot
  // reliably know the offset without registry config, so we report the instant as
  // the wall-clock components in UTC — downstream ingestion can re-apply the
  // device timezone. (Documented for the reference adapter.)
  const d = new Date(Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function bcd(byte: number | undefined): number {
  const b = byte ?? 0;
  return ((b >> 4) & 0x0f) * 10 + (b & 0x0f);
}

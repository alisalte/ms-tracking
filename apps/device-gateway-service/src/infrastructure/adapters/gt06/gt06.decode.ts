/**
 * GT06 decode — vendor frame → canonical DeviceMessage (06 §10.2 normalization).
 *
 * Handles the GT06 message types:
 *   - 0x01 LOGIN    → serialOrImei (8-byte BCD IMEI); deviceId/tenantId left empty
 *                     for the dispatcher's auth/resolve stage to fill.
 *   - 0x1a HEARTBEAT / 0x13 STATUS → HEARTBEAT (terminal info + voltage).
 *   - 0x10 GPS      → POSITION (lat/lng/speed/heading/time/fix-valid + ignition).
 *   - 0x05 ALARM    → ALARM (terminal-info alarm-type byte + the same GPS block as
 *                     0x10; mapped via the GT06N alarm-type table).
 *
 * Coordinate transform (Concox GT06 v1.8.1): the raw 4-byte lat/lng values are
 * minutes × 30000, so degrees = raw / 60 / 30000 for BOTH axes. The hemisphere
 * sign is carried in the 2-byte Course/Status word that follows the coordinates:
 *   bit 10 = latitude hemisphere  (1 = N/+, 0 = S/−)
 *   bit 11 = longitude hemisphere (0 = E/+, 1 = W/−)
 *   bits 0–9 = course/heading (0–359), bit 12 = GPS fix valid.
 * Verified against the spec's worked example 0x154C → North, East, course 332°.
 */
import { createHash } from 'node:crypto';
import { DeviceMessage, type Position } from '../../../domain/device-message.js';
import { ProtocolError } from '../../../domain/errors.js';
import type { RawPacket } from '../../../domain/raw-packet.js';
import { mapGt06Alarm } from './gt06.codes.js';
import { GT06_PROTOCOL, gt06Crc16 } from './gt06.frames.js';

/** Minimal frame layout accessors (start(2) proto(1) ... crc(2) stop(2)). */
interface Gt06Frame {
  readonly protocol: number; // message number byte
  readonly data: Buffer; // data region between protocol byte and info serial
  readonly infoSerial: number; // 2-byte information serial number
}

function parseFrame(payload: Buffer): Gt06Frame {
  // payload: start(2) proto(1) data... infoSerial(2) crc(2) stop(2)
  if (payload.length < 10) {
    throw new ProtocolError(`GT06 frame too short (${payload.length} bytes).`, 'gt06');
  }
  const protocol = payload[2] ?? 0;
  const infoSerial = ((payload[payload.length - 4] ?? 0) << 8) | (payload[payload.length - 3] ?? 0);
  const data = payload.subarray(3, payload.length - 4);
  return { protocol, data, infoSerial };
}

/** Decode the 8-byte BCD IMEI from a LOGIN data region. */
function decodeImei(data: Buffer): string {
  // LOGIN data = 8 bytes BCD IMEI. Render as 16 hex digits; some devices pad the
  // leading nibble, so we strip a single leading zero for the canonical IMEI.
  let hex = '';
  for (const b of data.subarray(0, 8)) {
    hex += (b ?? 0).toString(16).padStart(2, '0');
  }
  return hex.replace(/^0+(?=\d{15,})/, '');
}

/** Build the canonical DeviceMessage scaffold. */
function message(
  raw: RawPacket,
  partial: Pick<DeviceMessage, 'type' | 'timestamp'> &
    Partial<Pick<DeviceMessage, 'position' | 'alarms' | 'telemetry' | 'serialOrImei'>>,
): DeviceMessage {
  return new DeviceMessage({
    messageId: cryptoUuid(),
    deviceId: '',
    tenantId: '',
    serialOrImei: partial.serialOrImei ?? '',
    protocolId: 'gt06',
    type: partial.type,
    timestamp: partial.timestamp,
    ingestedAt: raw.receivedAt,
    position: partial.position,
    alarms: partial.alarms,
    telemetry: partial.telemetry,
    rawSize: raw.rawSize,
    checksum: sha256(raw.payload),
    direction: raw.direction,
  });
}

function cryptoUuid(): string {
  return globalThis.crypto.randomUUID();
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Decode a GT06 RawPacket into one or more DeviceMessages (06 §9.2). Throws
 * ProtocolError on an unsupported/undersized frame so the dispatcher's decode
 * stage can drop it and bump the `decode.error` metric.
 */
export function decodeGt06(raw: RawPacket): readonly DeviceMessage[] {
  const frame = parseFrame(raw.payload);

  switch (frame.protocol) {
    case GT06_PROTOCOL.LOGIN: {
      const imei = decodeImei(frame.data);
      return [
        message(raw, {
          type: 'LOGIN',
          serialOrImei: imei,
          timestamp: raw.receivedAt,
        }),
      ];
    }

    case GT06_PROTOCOL.HEARTBEAT:
    case GT06_PROTOCOL.STATUS: {
      // STATUS carries a terminal-info byte + voltage level; HEARTBEAT is empty.
      const telemetry: Record<string, unknown> = {};
      if (frame.data.length >= 1) {
        const terminalInfo = frame.data[0] ?? 0;
        telemetry.ignitionOn = (terminalInfo & 0x04) !== 0; // bit 2 = ACC/ignition
        telemetry.charging = (terminalInfo & 0x01) !== 0; // bit 0 = power/charge
      }
      if (frame.data.length >= 2) {
        telemetry.voltageLevel = frame.data[1]; // GSM voltage level (6 steps)
      }
      return [
        message(raw, {
          type: 'HEARTBEAT',
          timestamp: raw.receivedAt,
          telemetry,
        }),
      ];
    }

    case GT06_PROTOCOL.GPS: {
      const block = parseGpsPosition(frame.data);
      if (!block) {
        throw new ProtocolError('GT06 GPS frame too short / invalid fix.', 'gt06');
      }
      return [
        message(raw, {
          type: 'POSITION',
          timestamp: block.position.timestamp,
          position: block.position,
          telemetry: { ignitionOn: block.position.ignitionOn, fixValid: block.fixValid },
        }),
      ];
    }

    case GT06_PROTOCOL.ALARM: {
      // 0x05 alarm = a 1-byte terminal-info/alarm-type byte prepended to the same
      // GPS block as 0x10 (date + lat + lng + speed + course/status). The GPS block
      // reuses the corrected position parser so signs are right here too.
      if (frame.data.length < 1) {
        throw new ProtocolError('GT06 alarm frame missing terminal-info byte.', 'gt06');
      }
      const alarmType = frame.data[0] ?? 0;
      const block = parseGpsPosition(frame.data.subarray(1));
      if (!block) {
        throw new ProtocolError('GT06 alarm frame too short / invalid embedded fix.', 'gt06');
      }
      return [
        message(raw, {
          type: 'ALARM',
          timestamp: block.position.timestamp,
          position: block.position,
          alarms: [mapGt06Alarm(alarmType)],
          telemetry: {
            ignitionOn: block.position.ignitionOn,
            fixValid: block.fixValid,
            alarmType,
          },
        }),
      ];
    }

    default:
      throw new ProtocolError(
        `GT06 protocol number 0x${frame.protocol.toString(16)} not supported (decode).`,
        'gt06',
      );
  }
}

/** Parsed GPS block — a Position plus the fix-valid flag the Position type omits. */
interface GpsBlock {
  readonly position: Position;
  readonly fixValid: boolean;
}

/**
 * Parse the GT06 GPS data block (shared by 0x10 location and 0x05 alarm packets).
 * Layout: date(6 BCD: YYMMDDhhmmss) lat(4) lng(4) speed(1) course+status(2).
 *
 * The 2-byte course/status word (big-endian) packs:
 *   bits 0–9  = course/heading (0–359°)
 *   bit 10    = latitude hemisphere  (1 = N/+, 0 = S/−)
 *   bit 11    = longitude hemisphere (0 = E/+, 1 = W/−)
 *   bit 12    = GPS fix valid
 * Coordinates are minutes × 30000 → degrees = raw / 60 / 30000 for both axes.
 */
function parseGpsPosition(data: Buffer): GpsBlock | null {
  // date(6) + lat(4) + lng(4) + speed(1) + course/status(2) = 17 bytes minimum.
  if (data.length < 17) return null;

  let off = 0;
  // Date (BCD) — YY MM DD hh mm ss (6 bytes).
  const year = 2000 + bcd(data[off]);
  const month = bcd(data[off + 1]);
  const day = bcd(data[off + 2]);
  const hour = bcd(data[off + 3]);
  const minute = bcd(data[off + 4]);
  const second = bcd(data[off + 5]);
  off += 6;

  const latRaw = data.readUInt32BE(off);
  off += 4;
  const lngRaw = data.readUInt32BE(off);
  off += 4;
  const speed = data[off] ?? 0; // knots
  off += 1;
  const courseStatus = data.readUInt16BE(off); // big-endian 2-byte word
  off += 2;

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Coordinates are minutes × 30000 → degrees.
  let latitude = latRaw / 30000 / 60;
  let longitude = lngRaw / 30000 / 60;
  // Hemisphere bits in the course/status word (verified vs spec example 0x154C).
  if ((courseStatus & 0x0400) === 0) latitude = -latitude; // bit 10 clear → South
  if ((courseStatus & 0x0800) !== 0) longitude = -longitude; // bit 11 set → West

  const fixValid = (courseStatus & 0x1000) !== 0; // bit 12
  const heading = courseStatus & 0x03ff; // bits 0–9

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const position: Position = {
    latitude,
    longitude,
    speedKph: knotsToKph(speed),
    headingDeg: heading,
    altitudeM: null,
    satellites: null,
    timestamp: isValidDate(date) ? date : new Date(),
    // GT06 does not carry ignition in the GPS block itself; the 0x1a/0x13 terminal-
    // info byte does. Some variants encode ignition in course/status bits 14/15
    // (bit 14 = ignition present, bit 15 = state); surface it when present.
    ignitionOn: (courseStatus & 0x4000) !== 0 ? (courseStatus & 0x8000) !== 0 : null,
  };
  return { position, fixValid };
}

function bcd(byte: number | undefined): number {
  const b = byte ?? 0;
  return ((b >> 4) & 0x0f) * 10 + (b & 0x0f);
}

function knotsToKph(knots: number): number {
  return Math.round(knots * 1.852);
}

function isValidDate(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

// Re-export for adapter encode() use (acks re-use the CRC helper).
export { gt06Crc16 };

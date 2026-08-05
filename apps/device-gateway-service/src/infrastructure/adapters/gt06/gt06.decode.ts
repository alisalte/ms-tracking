/**
 * GT06 decode — vendor frame → canonical DeviceMessage (06 §10.2 normalization).
 *
 * Handles the GT06 message types needed to prove the pipeline end-to-end:
 *   - 0x01 LOGIN    → serialOrImei (8-byte BCD IMEI); deviceId/tenantId left empty
 *                     for the dispatcher's auth/resolve stage to fill.
 *   - 0x1a HEARTBEAT / 0x13 STATUS → HEARTBEAT (terminal info + voltage).
 *   - 0x10 GPS      → POSITION (lat/lng/speed/heading/time + ignition from terminal info).
 *
 *imei parsing: GT06 sends the IMEI as 8 BCD bytes (16 digits) in the LOGIN data.
 * Position uses the WGS-84 coordinate transform documented for GT06: degrees =
 * raw / 30000 / 60 (latitude) and raw / 30000 / 60 (longitude), which is the
 * classic GT06 minutes-with-fraction encoding.
 */
import { createHash } from 'node:crypto';
import { DeviceMessage, type Position } from '../../../domain/device-message.js';
import { ProtocolError } from '../../../domain/errors.js';
import type { RawPacket } from '../../../domain/raw-packet.js';
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
      const pos = parseGpsPosition(frame.data);
      if (!pos) {
        throw new ProtocolError('GT06 GPS frame too short / invalid fix.', 'gt06');
      }
      return [
        message(raw, {
          type: 'POSITION',
          timestamp: pos.timestamp,
          position: pos,
          telemetry: { ignitionOn: pos.ignitionOn },
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

/** Parse the GT06 0x10 GPS data block into a canonical Position. */
function parseGpsPosition(data: Buffer): Position | null {
  // Layout (0x10): date(6 BCP: YYMMDD) lat(4) lng(4) speed(1) heading(2) terminalInfo(1)
  // We need >= 20 bytes for a full fix. (Some variants differ; this covers the common case.)
  if (data.length < 20) return null;

  let off = 0;
  // Date (BCD) — YY MM DD hh mm ss (6 bytes).
  const year = 2000 + bcd(data[off]);
  const month = bcd(data[off + 1]);
  const day = bcd(data[off + 2]);
  const hour = bcd(data[off + 3]);
  const minute = bcd(data[off + 4]);
  const second = bcd(data[off + 5]);
  off += 6;

  const latRaw = data.readUInt32BE(off); // 0..4
  off += 4;
  const lngRaw = data.readUInt32BE(off); // 4..8
  off += 4;
  const speed = data[off] ?? 0; // knots
  off += 1;
  const heading = ((data[off] ?? 0) << 8) | (data[off + 1] ?? 0); // 0..359
  off += 2;
  const terminalInfo = data[off] ?? 0;
  const ignitionOn = (terminalInfo & 0x04) !== 0;

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // GT06 lat/lng are in minutes*30000; convert to degrees.
  const latitude = latRaw / 30000 / 60;
  let longitude = lngRaw / 30000 / 60;
  // Longitude sign handling: GT06 sends absolute; east positive, west negative.
  // We cannot derive E/W from the raw frame alone in the minimal subset, so the
  // value is reported as the magnitude — downstream ingestion resolves sign from
  // the device registry region. (Documented limitation for the reference adapter.)
  longitude = Math.abs(longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    speedKph: knotsToKph(speed),
    headingDeg: heading & 0x1ff, // 9 bits 0..359
    altitudeM: null,
    satellites: null,
    timestamp: isValidDate(date) ? date : new Date(),
    ignitionOn,
  };
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

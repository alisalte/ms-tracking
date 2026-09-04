/**
 * Meitrack encode — canonical DeviceCommand → server→device wire bytes
 * (Meitrack GPRS Protocol v1.6; 06 §9.1).
 *
 * Server→device frame layout:
 *
 *   @@<id><len>,<imei>,<content>*<cc>\r\n
 *
 * The data ID is a single char; the length is decimal ASCII counting from the
 * first comma through the \r\n (inclusive); the checksum is the modular byte sum
 * from '@@' through '*' (inclusive), mod 256, %02X — the same rule used inbound.
 *
 * Supports the ACK + Device Configuration deliverables:
 *   - LOGIN_ACK / HEARTBEAT_ACK / generic ACK → an AAC confirmation to the device.
 *   - TRACK_ON_DEMAND (A10), HEARTBEAT_INTERVAL (A11), REBOOT (F03), and a
 *     generic command passthrough for anything else in `payload.command`.
 *   - payload.hex → a binary-bodied frame (MDVR media command structs,
 *     Meitrack MDVR GPRS Protocol V2.0 §3.16–§3.31) via buildMeitrackBinaryFrame.
 */
import type { DeviceCommand } from '../../protocol/protocol-adapter.js';
import { MEITRACK_OUT_COMMAND } from './meitrack.codes.js';
import { MEITRACK_COMMAND } from './meitrack.frames.js';
import { meitrackChecksum } from './meitrack.frames.js';

/** Data ID used for outbound command frames (same family as inbound). */
const OUT_DATA_ID = 'A';
const OUT_FLAG = '@@';
const TAIL = '\r\n';

/** md300 `buildGPRSCommand` data-ids for media commands. */
function mediaDataId(body: Buffer): string {
  if (body.length >= 3) {
    const code = body.toString('ascii', 0, 3);
    if (code === 'AB2') return 'u';
    if (code === 'AB3') return 'v';
    if (code === 'A9A') return 'y';
    if (code === 'A9B') return 'w';
  }
  return OUT_DATA_ID;
}

/**
 * Build a complete server→device Meitrack frame for `content` (the comma-fields
 * after the length comma, i.e. `<imei>,<command>[,<args>]`). Computes length and
 * checksum per the spec.
 */
export function buildMeitrackFrame(content: string): Buffer {
  const commaBlock = `,${content}`;
  // Length = comma + content + '*' + checksum(2) + '\r\n'(2).
  const length = commaBlock.length + 1 + 2 + 2;
  const lengthStr = String(length);
  const head = `${OUT_FLAG}${OUT_DATA_ID}${lengthStr}`;
  const checksumRegion = `${head}${commaBlock}*`;
  const checksum = meitrackChecksum(Buffer.from(checksumRegion, 'ascii'));
  return Buffer.from(`${checksumRegion}${checksum}${TAIL}`, 'ascii');
}

/**
 * Binary-bodied variant for MDVR media commands (A9A/A9C/A9D/A9F/AB2/AB4/AB8…):
 * `head` + `,` + `asciiPrefix` (e.g. `<imei>,A9A,`) + `body` raw struct bytes,
 * then `*<checksum>\r\n`. The length counts from the comma through the tail and
 * the checksum sums the raw bytes from `@@` through `*` — identical rule to the
 * ASCII path, just byte-wise.
 */
export function buildMeitrackBinaryFrame(
  asciiPrefix: string,
  body: Buffer,
  dataId = OUT_DATA_ID,
): Buffer {
  const comma = Buffer.from(',', 'ascii');
  const star = Buffer.from('*', 'ascii');
  const tail = Buffer.from(TAIL, 'ascii');
  const head = Buffer.from(OUT_FLAG + dataId, 'ascii');
  const bodyBytes = Buffer.concat([comma, Buffer.from(asciiPrefix, 'ascii'), body, star]);
  // length = comma + prefix + body + '*' + checksum(2) + '\r\n'(2).
  const length = bodyBytes.length + 2 + 2;
  const lengthBytes = Buffer.from(String(length), 'ascii');
  const checksumRegion = Buffer.concat([head, lengthBytes, bodyBytes]);
  const checksum = meitrackChecksum(checksumRegion);
  return Buffer.concat([checksumRegion, Buffer.from(checksum, 'ascii'), tail]);
}

/**
 * Encode a downstream DeviceCommand to a Meitrack server→device frame. Returns an
 * empty Buffer for unsupported commands (the dispatcher rejects writing those).
 */
export function encodeMeitrack(cmd: DeviceCommand): Buffer {
  const imei = String(cmd.payload.imei ?? cmd.deviceId ?? '');
  if (!imei) {
    // Without an IMEI we cannot address the device.
    return Buffer.alloc(0);
  }

  switch (cmd.type) {
    case 'LOGIN_ACK':
    case 'HEARTBEAT_ACK':
    case 'COMMAND_ACK':
      // Confirm the last device packet — Meitrack AAC ack.
      return buildMeitrackFrame(`${imei},${MEITRACK_COMMAND.ACK}`);

    default:
      // Any other type (TELEMETRY/PHOTO/COMMAND/etc.) is treated as a config command.
      return encodeConfigCommand(cmd, imei);
  }
}

/** Encode a device-configuration / command-type DeviceCommand (06 §9.1). */
function encodeConfigCommand(cmd: DeviceCommand, imei: string): Buffer {
  // Binary body (MDVR media structs): payload.hex is the hex-encoded wire body
  // after `<imei>,` (e.g. 'A9B' + ',' + struct bytes).
  if (typeof cmd.payload.hex === 'string' && cmd.payload.hex.length > 0) {
    const body = Buffer.from(cmd.payload.hex, 'hex');
    if (body.length === 0) return Buffer.alloc(0);
    // md300 live.js uses data-id 'u' for AB2 and 'v' for AB3.
    return buildMeitrackBinaryFrame(`${imei},`, body, mediaDataId(body));
  }

  const command = String(cmd.payload.command ?? '');
  switch (command) {
    case MEITRACK_OUT_COMMAND.TRACK_ON_DEMAND: {
      // A10,<minutes> — 0 = one-shot track on demand.
      const minutes = Number(cmd.payload.minutes ?? 0);
      return buildMeitrackFrame(`${imei},${MEITRACK_OUT_COMMAND.TRACK_ON_DEMAND},${minutes}`);
    }
    case MEITRACK_OUT_COMMAND.HEARTBEAT_INTERVAL: {
      // A11,<intervalSeconds> (0 = disable keep-alive).
      const seconds = Number(cmd.payload.intervalSeconds ?? cmd.payload.seconds ?? 0);
      return buildMeitrackFrame(`${imei},${MEITRACK_OUT_COMMAND.HEARTBEAT_INTERVAL},${seconds}`);
    }
    case MEITRACK_OUT_COMMAND.REBOOT: {
      return buildMeitrackFrame(`${imei},${MEITRACK_OUT_COMMAND.REBOOT}`);
    }
    default: {
      // Generic passthrough: payload.text is emitted verbatim as the command body.
      const text = String(cmd.payload.text ?? '');
      if (!text) return Buffer.alloc(0);
      return buildMeitrackFrame(`${imei},${text}`);
    }
  }
}

/**
 * JT808 encode — canonical DeviceCommand → server→device wire bytes
 * (06 §9.1; JT/T 808-2019). Server→device frames use the same layout, escape, and
 * BCC checksum as uplink frames, with the platform's own message ids (0x8xxx).
 *
 * Supports the Command + Upgrade deliverables:
 *   - LOGIN_ACK            → 0x8100 注册应答 (registration response; carries auth_code).
 *   - HEARTBEAT_ACK /      → 0x8001 平台通用应答 (platform general response).
 *     COMMAND_ACK
 *   - TELEMETRY (command)  → 0x8105 终端控制 (terminal control: reboot/reset/…).
 *   - Upgrade              → 0x8108 终端升级 (OTA upgrade package).
 *
 * The adapter owns one outbound message-serial (msgSn) counter per the spec
 * (per-direction 16-bit, wraps at 0xffff). The reference Traccar encoder
 * hardcodes msgSn=0; we do it correctly.
 */
import type { DeviceCommand } from '../../protocol/protocol-adapter.js';
import { JT808_FLAG, escape808, jt808Checksum } from './jt808.frames.js';
import { MSG, stringToBcd } from './jt808.header.js';

/** 0x8105 terminal-control command words (JT/T 808-2019). */
const CONTROL_WORD = {
  WIRELESS_RESTART: 0x01,
  WIRELESS_RESET: 0x02,
  WIRELESS_UPGRADE: 0x03,
  FACTORY_RESET: 0x04,
  POWER_OFF_DISCONNECT: 0x05,
  POWER_OFF_RECONNECT: 0x06,
} as const;

/**
 * JT808 server→device frame builder. Owns the outbound message-serial counter.
 * Construct one instance per adapter (shared across that protocol's connections —
 * the counter only needs to be unique per platform direction, not per device).
 */
export class Jt808Encoder {
  /** Outbound message serial number, increments per frame, wraps at 0xffff. */
  private msgSn = 0;

  /** Consume and return the next outbound message-serial number. */
  private nextMsgSn(): number {
    const sn = this.msgSn;
    this.msgSn = (this.msgSn + 1) & 0xffff;
    return sn;
  }

  /**
   * Build a complete server→device frame for `msgId` + `body`, addressed to the
   * BCD `phone` digits. Computes bodyProps, the BCC checksum, and applies the
   * 0x7d/0x7e escape before wrapping in 0x7e delimiters. Defaults to 2013 framing
   * (6-byte phone); set `version2019` for the 2019 header (10-byte phone + ver byte).
   */
  public buildFrame(
    msgId: number,
    phone: string,
    body: Buffer,
    opts: { version2019?: boolean; msgSn?: number } = {},
  ): Buffer {
    const version2019 = opts.version2019 ?? false;
    const sn = opts.msgSn ?? this.nextMsgSn();
    const phoneBytes = version2019 ? 10 : 6;

    // Assemble the unstuffed region: msgId + bodyProps + [ver] + phone + msgSn + body.
    const parts: Buffer[] = [];
    parts.push(writeU16(msgId));
    const bodyProps = (body.length & 0x03ff) | (version2019 ? 0x4000 : 0) /* version bit */;
    parts.push(writeU16(bodyProps));
    if (version2019) parts.push(Buffer.from([0x01])); // protocol version byte
    parts.push(stringToBcd(phone, phoneBytes));
    parts.push(writeU16(sn));
    parts.push(body);
    const unstuffedRegion = Buffer.concat(parts);

    // BCC over msgId..last-body-byte (the whole unstuffed region).
    const checksum = jt808Checksum(unstuffedRegion);
    const withChecksum = Buffer.concat([unstuffedRegion, Buffer.from([checksum])]);

    // Escape the region, then wrap in 0x7e delimiters.
    const escaped = escape808(withChecksum);
    return Buffer.concat([Buffer.from([JT808_FLAG]), escaped, Buffer.from([JT808_FLAG])]);
  }

  /** Encode a downstream DeviceCommand to a JT808 server→device frame. */
  public encode(cmd: DeviceCommand): Buffer {
    const phone = String(cmd.payload.phone ?? cmd.payload.imei ?? cmd.deviceId ?? '');
    if (!phone) return Buffer.alloc(0); // cannot address without a phone/identity

    switch (cmd.type) {
      case 'LOGIN_ACK':
        return this.encodeRegisterResponse(cmd, phone);
      case 'HEARTBEAT_ACK':
      case 'COMMAND_ACK':
        return this.encodeGeneralResponse(cmd, phone);
      default:
        // POSITION / ALARM / TELEMETRY / etc. are treated as control/upgrade.
        return this.encodeControlOrUpgrade(cmd, phone);
    }
  }

  /** 0x8100 Registration Response (LOGIN_ACK). Body: seq(2) result(1) authCode. */
  private encodeRegisterResponse(cmd: DeviceCommand, phone: string): Buffer {
    const seq = Number(cmd.payload.msgSn ?? 0) & 0xffff;
    const result = Number(cmd.payload.result ?? 0) & 0xff;
    const authCode = Buffer.from(String(cmd.payload.authCode ?? cmd.payload.imei ?? ''), 'ascii');
    const body = Buffer.concat([writeU16(seq), Buffer.from([result]), authCode]);
    return this.buildFrame(MSG.REGISTER_RESPONSE, phone, body, { msgSn: seq });
  }

  /**
   * 0x8001 Platform General Response (COMMAND_ACK / HEARTBEAT_ACK).
   * Body: seq(2) id(2) result(1).
   */
  private encodeGeneralResponse(cmd: DeviceCommand, phone: string): Buffer {
    const seq = Number(cmd.payload.msgSn ?? 0) & 0xffff;
    const ackedId = Number(cmd.payload.ackedMessageId ?? 0) & 0xffff;
    const result = Number(cmd.payload.result ?? 0) & 0xff;
    const body = Buffer.concat([writeU16(seq), writeU16(ackedId), Buffer.from([result])]);
    return this.buildFrame(MSG.PLATFORM_GENERAL_RESPONSE, phone, body, { msgSn: seq });
  }

  /** 0x8105 Terminal Control or 0x8108 Terminal Upgrade, selected by payload.command. */
  private encodeControlOrUpgrade(cmd: DeviceCommand, phone: string): Buffer {
    const command = String(cmd.payload.command ?? '');
    if (command === 'UPGRADE' || command === '0x8108') {
      return this.encodeUpgrade(cmd, phone);
    }
    return this.encodeControl(cmd, phone);
  }

  /** 0x8105 Terminal Control. Body: commandWord(1) param(string). */
  private encodeControl(cmd: DeviceCommand, phone: string): Buffer {
    const word = controlWord(String(cmd.payload.controlWord ?? cmd.payload.command ?? ''));
    const param = Buffer.from(String(cmd.payload.param ?? ''), 'ascii');
    const body = Buffer.concat([Buffer.from([word]), param]);
    return this.buildFrame(MSG.TERMINAL_CONTROL, phone, body);
  }

  /**
   * 0x8108 Terminal Upgrade (OTA).
   * Body: upgradeType(1) manufacturer(5) versionLen(1) version version packageLen(4) package.
   */
  private encodeUpgrade(cmd: DeviceCommand, phone: string): Buffer {
    const upgradeType = Number(cmd.payload.upgradeType ?? 0) & 0xff;
    const manufacturer = Buffer.alloc(5);
    const manStr = String(cmd.payload.manufacturer ?? '').slice(0, 5);
    manufacturer.write(manStr, 'ascii');
    const version = Buffer.from(String(cmd.payload.version ?? ''), 'ascii');
    const versionLen = Buffer.from([version.length & 0xff]);
    const pkg = Buffer.isBuffer(cmd.payload.package)
      ? cmd.payload.package
      : Buffer.from(String(cmd.payload.package ?? ''), 'base64');
    const packageLen = Buffer.alloc(4);
    packageLen.writeUInt32BE(pkg.length, 0);
    const body = Buffer.concat([
      Buffer.from([upgradeType]),
      manufacturer,
      versionLen,
      version,
      packageLen,
      pkg,
    ]);
    return this.buildFrame(MSG.TERMINAL_UPGRADE, phone, body);
  }
}

/** Map a control command name/word to the 0x8105 command-word byte. */
function controlWord(name: string): number {
  const upper = name.toUpperCase();
  switch (upper) {
    case 'REBOOT':
    case 'WIRELESS_RESTART':
    case '0x01':
      return CONTROL_WORD.WIRELESS_RESTART;
    case 'RESET':
    case 'WIRELESS_RESET':
    case '0x02':
      return CONTROL_WORD.WIRELESS_RESET;
    case 'FACTORY_RESET':
    case '0x04':
      return CONTROL_WORD.FACTORY_RESET;
    case 'POWER_OFF_DISCONNECT':
    case '0x05':
      return CONTROL_WORD.POWER_OFF_DISCONNECT;
    case 'POWER_OFF_RECONNECT':
    case '0x06':
      return CONTROL_WORD.POWER_OFF_RECONNECT;
    default:
      // Unknown name → assume a numeric command word was supplied directly.
      return Number.parseInt(upper, 16) || CONTROL_WORD.WIRELESS_RESTART;
  }
}

function writeU16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value & 0xffff, 0);
  return buf;
}

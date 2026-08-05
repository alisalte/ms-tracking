/**
 * GT06 adapter — the reference built-in protocol adapter (06 §2.1, §9.1).
 *
 * Implements the ProtocolAdapter contract over `gt06.frames` (framing + CRC) and
 * `gt06.decode` (normalization). Proves the full PAL contract end-to-end; the
 * other six protocols (JT808, JT1078, Teltonika, Meitrack, Concox, Queclink) are
 * later-sprint adapter modules against this same interface.
 */
import type { DeviceMessage } from '../../../domain/device-message.js';
import type { RawPacket } from '../../../domain/raw-packet.js';
import type {
  DeviceCommand,
  ProtocolAdapter,
  ProtocolMeta,
} from '../../protocol/protocol-adapter.js';
import type { ByteReader, NeedMore } from '../../transport/byte-reader.js';
import { decodeGt06 } from './gt06.decode.js';
import { GT06_PROTOCOL, frameGt06, gt06Crc16 } from './gt06.frames.js';

const GT06_META: ProtocolMeta = {
  name: 'GT06 / Concox',
  defaultPort: 5016,
  transport: 'both',
  framingType: 'start 0x78 0x78, CRC-16, stop 0x0D 0x0A',
  authStrategy: 'Login 0x01 → 8-byte IMEI (BCD)',
  deviceModels: ['GT06', 'GT06N', 'TR06', 'Concox CR/JT/X'],
};

export class Gt06Adapter implements ProtocolAdapter {
  public readonly id = 'gt06';
  public readonly meta = GT06_META;

  public detect(peek: Buffer): { confidence: number } {
    if (peek.length >= 2 && peek[0] === 0x78 && peek[1] === 0x78) {
      return { confidence: 0.95 };
    }
    return { confidence: 0 };
  }

  public frame(reader: ByteReader, receivedAt: Date): RawPacket | NeedMore {
    return frameGt06(reader, receivedAt);
  }

  public decode(raw: RawPacket): readonly DeviceMessage[] {
    return decodeGt06(raw);
  }

  /**
   * Encode a downstream command for GT06. Supports a generic server-ack reply
   * (the gateway echoes the device's information-serial number for login/heartbeat
   * acks per the protocol) — full command set is later-sprint per-protocol work.
   */
  public encode(cmd: DeviceCommand): Buffer {
    if (cmd.type === 'LOGIN_ACK' || cmd.type === 'HEARTBEAT_ACK') {
      const infoSerial = Number(cmd.payload.infoSerial ?? 0) & 0xffff;
      // Ack frame: 78 78 05 [serverFlag] infoSerial crc 0d 0a
      // Server flag for login/heartbeat ack is the protocol number (0x01/0x1a).
      const serverFlag = cmd.type === 'LOGIN_ACK' ? GT06_PROTOCOL.LOGIN : GT06_PROTOCOL.HEARTBEAT;
      const infoHi = (infoSerial >> 8) & 0xff;
      const infoLo = infoSerial & 0xff;
      const crc = gt06Crc16(Buffer.from([serverFlag, infoHi, infoLo]));
      return Buffer.from([
        0x78,
        0x78,
        0x05,
        serverFlag,
        infoHi,
        infoLo,
        (crc >> 8) & 0xff,
        crc & 0xff,
        0x0d,
        0x0a,
      ]);
    }
    // Unknown command → empty payload (the dispatcher rejects writing it).
    return Buffer.alloc(0);
  }
}

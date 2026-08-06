/**
 * JT808 adapter — built-in protocol adapter for the Chinese national JT/T 808-2019
 * commercial-vehicle protocol (06 §2.1, §9.1).
 *
 * Implements the ProtocolAdapter contract over `jt808.frames` (delimiter framing
 * + 0x7d/0x7e escape + BCC checksum), `jt808.decode` (normalization), and
 * `jt808.encode` (server→device commands). Sibling module to GT06 / Meitrack
 * against the same ProtocolAdapter contract.
 *
 * Auth model: JT/T 808's strict handshake is 0x0100 register → 0x8100 response
 * (with auth_code) → 0x0102 authenticate. This adapter uses the permissive model
 * (like the reference Traccar decoder): 0x0100 registration is treated as the
 * session-establishing packet, and because every JT808 frame carries the BCD phone
 * number as `serialOrImei`, the dispatcher's implicit-login path (06 §7)
 * authenticates off the first frame. The platform's 0x8100 response is emitted on
 * demand via encode() (LOGIN_ACK).
 */
import type { DeviceMessage } from '../../../domain/device-message.js';
import type { RawPacket } from '../../../domain/raw-packet.js';
import type {
  DeviceCommand,
  ProtocolAdapter,
  ProtocolMeta,
} from '../../protocol/protocol-adapter.js';
import type { ByteReader, NeedMore } from '../../transport/byte-reader.js';
import { decodeJt808 } from './jt808.decode.js';
import { Jt808Encoder } from './jt808.encode.js';
import { frameJt808 } from './jt808.frames.js';

const JT808_META: ProtocolMeta = {
  name: 'JT808 (JT/T 808-2019)',
  defaultPort: 7611,
  transport: 'tcp',
  framingType: '0x7e delimited, 0x7d byte-stuffing, BCC (XOR) checksum',
  authStrategy: '0x0100 register → 0x8100 → 0x0102 (permissive: register authenticates)',
  deviceModels: ['JT808-2013', 'JT808-2019 commercial-vehicle terminals'],
};

export class Jt808Adapter implements ProtocolAdapter {
  public readonly id = 'jt808';
  public readonly meta = JT808_META;

  /** Owns the outbound message-serial counter (one per adapter instance). */
  private readonly encoder = new Jt808Encoder();

  public detect(peek: Buffer): { confidence: number } {
    // 06 §2.3: 0x7e leading delimiter is the JT808 signal, but it is weaker than
    // GT06's 0x78 0x78 / Meitrack's "$$"; the msgId-in-header + BCD phone confirm.
    // A leading 0x7e alone earns moderate confidence (below the 0.95 family marks).
    if (peek.length >= 1 && peek[0] === 0x7e) {
      return { confidence: 0.85 };
    }
    return { confidence: 0 };
  }

  public frame(reader: ByteReader, receivedAt: Date): RawPacket | NeedMore {
    return frameJt808(reader, receivedAt);
  }

  public decode(raw: RawPacket): readonly DeviceMessage[] {
    return decodeJt808(raw);
  }

  public encode(cmd: DeviceCommand): Buffer {
    return this.encoder.encode(cmd);
  }
}

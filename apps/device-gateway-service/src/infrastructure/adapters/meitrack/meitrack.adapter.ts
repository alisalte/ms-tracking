/**
 * Meitrack adapter — built-in protocol adapter for the Meitrack family
 * (06 §2.1, §9.1; Meitrack GPRS Protocol v1.6).
 *
 * Implements the ProtocolAdapter contract over `meitrack.frames` (framing +
 * checksum), `meitrack.decode` (normalization), and `meitrack.encode` (server→
 * device commands). The companion GT06 adapter is the reference; this is a sibling
 * module against the same contract.
 *
 * Auth model: Meitrack carries the IMEI in every packet (no dedicated login), so
 * the dispatcher authenticates off the first packet via the implicit-login path
 * (06 §7). Each decoded message therefore surfaces `serialOrImei` regardless of
 * type.
 */
import type { DeviceMessage } from '../../../domain/device-message.js';
import type { RawPacket } from '../../../domain/raw-packet.js';
import type {
  DeviceCommand,
  ProtocolAdapter,
  ProtocolMeta,
} from '../../protocol/protocol-adapter.js';
import type { ByteReader, NeedMore } from '../../transport/byte-reader.js';
import { decodeMeitrack } from './meitrack.decode.js';
import { encodeMeitrack } from './meitrack.encode.js';
import { frameMeitrack } from './meitrack.frames.js';

const MEITRACK_META: ProtocolMeta = {
  name: 'Meitrack',
  defaultPort: 5023,
  transport: 'tcp',
  framingType: 'start "$$", decimal length, byte-sum checksum (mod 256), stop \\r\\n',
  authStrategy: 'IMEI in every packet (implicit login on first packet)',
  deviceModels: ['MVT380', 'MT90', 'P99B', 'T622', 'MVT340'],
};

export class MeitrackAdapter implements ProtocolAdapter {
  public readonly id = 'meitrack';
  public readonly meta = MEITRACK_META;

  public detect(peek: Buffer): { confidence: number } {
    // 06 §2.3 detection table: "$$" prefix ⇒ Meitrack.
    if (peek.length >= 2 && peek[0] === 0x24 && peek[1] === 0x24) {
      return { confidence: 0.95 };
    }
    return { confidence: 0 };
  }

  public frame(reader: ByteReader, receivedAt: Date): RawPacket | NeedMore {
    return frameMeitrack(reader, receivedAt);
  }

  public decode(raw: RawPacket): readonly DeviceMessage[] {
    return decodeMeitrack(raw);
  }

  public encode(cmd: DeviceCommand): Buffer {
    return encodeMeitrack(cmd);
  }
}

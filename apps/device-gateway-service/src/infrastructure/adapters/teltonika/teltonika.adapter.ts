/**
 * Teltonika adapter — FMB640 and the rest of the FMB/FMC/FMT family
 * (Teltonika Data Sending Protocols; codecs 8, 8 Extended, 16, and 12 replies).
 *
 * Auth model: the device sends its IMEI once, as the first frame of the TCP
 * connection, and expects a 1-byte accept/reject. AVL packets that follow carry
 * no identity, so the IMEI frame decodes to a LOGIN and the dispatcher binds the
 * session identity onto every later message.
 *
 * Delivery model: the device keeps records in flash until the server answers an
 * AVL packet with the number of records it stored. `acknowledge()` supplies that
 * reply; the dispatcher only sends it after every message of the packet has
 * been published, so a Kafka outage leads to a resend, never to lost data.
 */
import type { DeviceMessage } from '../../../domain/device-message.js';
import type { RawPacket } from '../../../domain/raw-packet.js';
import type {
  DeviceCommand,
  ProtocolAdapter,
  ProtocolMeta,
} from '../../protocol/protocol-adapter.js';
import type { ByteReader, NeedMore } from '../../transport/byte-reader.js';
import { avlRecordCount, decodeTeltonika } from './teltonika.decode.js';
import { encodeTeltonika } from './teltonika.encode.js';
import { frameTeltonika, isImeiFrame } from './teltonika.frames.js';

const TELTONIKA_META: ProtocolMeta = {
  name: 'Teltonika',
  defaultPort: 6180,
  transport: 'tcp',
  framingType: 'IMEI frame (len + ASCII) then AVL: 00000000 + length + codec data + CRC-16/IBM',
  authStrategy: 'IMEI frame first → server replies 0x01 (accept) / 0x00 (reject)',
  deviceModels: ['FMB640', 'FMB120', 'FMB920', 'FMC130', 'FMC640', 'FMB140'],
};

export class TeltonikaAdapter implements ProtocolAdapter {
  public readonly id = 'teltonika';
  public readonly meta = TELTONIKA_META;

  public detect(peek: Buffer): { confidence: number } {
    // IMEI frame: 00 0F + 15 ASCII digits.
    if (
      peek.length >= 17 &&
      peek[0] === 0x00 &&
      peek[1] === 0x0f &&
      /^\d{15}$/.test(peek.subarray(2, 17).toString('latin1'))
    ) {
      return { confidence: 0.95 };
    }
    // AVL data: 4 zero bytes, then a known codec id after the length field.
    if (peek.length >= 9 && peek.readUInt32BE(0) === 0) {
      const codec = peek[8];
      if (codec === 0x08 || codec === 0x8e || codec === 0x10 || codec === 0x0c) {
        return { confidence: 0.85 };
      }
    }
    return { confidence: 0 };
  }

  public frame(reader: ByteReader, receivedAt: Date): RawPacket | NeedMore {
    return frameTeltonika(reader, receivedAt);
  }

  public decode(raw: RawPacket): readonly DeviceMessage[] {
    return decodeTeltonika(raw);
  }

  public encode(cmd: DeviceCommand): Buffer {
    return encodeTeltonika(cmd);
  }

  public acknowledge(raw: RawPacket, accepted: boolean): Buffer | null {
    if (isImeiFrame(raw.payload)) {
      return encodeTeltonika({
        deviceId: '',
        type: accepted ? 'LOGIN_ACK' : 'LOGIN_NACK',
        payload: {},
      });
    }
    // Rejected AVL data is simply not acknowledged — the device resends it.
    if (!accepted) return null;
    const count = avlRecordCount(raw.payload);
    // Codec 12 replies (count === null) are not acknowledged.
    if (count === null) return null;
    return encodeTeltonika({ deviceId: '', type: 'AVL_ACK', payload: { count } });
  }
}

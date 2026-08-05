/**
 * Stub adapter — a minimal length-prefixed protocol used to exercise the plugin
 * system and the pipeline in tests/integration without a full vendor decoder
 * (06 §9.3 plugin discovery).
 *
 * Frame layout (simple, host-order): magic(2: 0xAB 0xCD) length(2 BE) payload(N) crc8(1).
 * Magic is the peek signal. The single message type is encoded in payload[0].
 *   payload[0] = 0x01 LOGIN, 0x10 POSITION, 0x1a HEARTBEAT
 * This is NOT a real protocol — it exists so the gateway core is demonstrable
 * without committing to a vendor format.
 */
import { createHash } from 'node:crypto';
import { DeviceMessage } from '../../../domain/device-message.js';
import { ProtocolError } from '../../../domain/errors.js';
import { RawPacket } from '../../../domain/raw-packet.js';
import type {
  DeviceCommand,
  ProtocolAdapter,
  ProtocolMeta,
} from '../../protocol/protocol-adapter.js';
import { type ByteReader, NEED_MORE, type NeedMore } from '../../transport/byte-reader.js';

const MAGIC = Buffer.from([0xab, 0xcd]);
const HEADER = 4; // magic(2) + length(2)
const TAIL = 1; // crc8(1)

const STUB_META: ProtocolMeta = {
  name: 'Stub (test/plugin)',
  defaultPort: 5099,
  transport: 'both',
  framingType: 'magic 0xAB 0xCD, length-prefixed (2 BE), crc8',
  authStrategy: 'payload[0]=0x01 carries an ASCII serial',
  deviceModels: ['stub-tracker'],
};

function crc8(buf: Buffer): number {
  let crc = 0x00;
  for (const b of buf) crc = (crc + (b ?? 0)) & 0xff;
  return crc & 0xff;
}

export class StubAdapter implements ProtocolAdapter {
  public readonly id = 'stub';
  public readonly meta = STUB_META;

  public detect(peek: Buffer): { confidence: number } {
    if (peek.length >= 2 && peek[0] === MAGIC[0] && peek[1] === MAGIC[1]) {
      return { confidence: 0.9 };
    }
    return { confidence: 0 };
  }

  public frame(reader: ByteReader, receivedAt: Date): RawPacket | NeedMore {
    // Skip until magic.
    while (reader.available >= MAGIC.length) {
      const head = reader.peek(2);
      if (head[0] === MAGIC[0] && head[1] === MAGIC[1]) break;
      reader.read(1);
    }
    if (reader.available < HEADER) return NEED_MORE;

    const header = reader.peek(HEADER);
    const length = ((header[2] ?? 0) << 8) | (header[3] ?? 0);
    const totalLen = HEADER + length + TAIL;
    if (reader.available < totalLen) return NEED_MORE;

    const read = reader.read(totalLen);
    if (read === NEED_MORE) return NEED_MORE;
    const full: Buffer = read;

    const receivedCrc = full[full.length - 1] ?? 0;
    const expectedCrc = crc8(full.subarray(2, full.length - 1)); // over length+payload
    if (receivedCrc !== expectedCrc) {
      throw new ProtocolError(
        `Stub CRC8 mismatch: got 0x${receivedCrc.toString(16)}, expected 0x${expectedCrc.toString(16)}.`,
        'stub',
      );
    }

    return new RawPacket({
      protocolId: 'stub',
      payload: Buffer.from(full),
      receivedAt,
      direction: 'INBOUND',
    });
  }

  public decode(raw: RawPacket): readonly DeviceMessage[] {
    const body = raw.payload.subarray(HEADER, raw.payload.length - TAIL);
    if (body.length < 1) throw new ProtocolError('Stub frame has no type byte.', 'stub');
    const typeByte = body[0] ?? 0;
    const rest = body.subarray(1).toString('utf8');

    const ingestedAt = raw.receivedAt;
    const type = typeByte === 0x01 ? 'LOGIN' : typeByte === 0x10 ? 'POSITION' : 'HEARTBEAT';

    const msg = new DeviceMessage({
      messageId: globalThis.crypto.randomUUID(),
      deviceId: '',
      tenantId: '',
      serialOrImei: type === 'LOGIN' ? rest : '',
      protocolId: 'stub',
      type: type as DeviceMessage['type'],
      timestamp: ingestedAt,
      ingestedAt,
      telemetry:
        type === 'POSITION'
          ? { sample: Number(rest) || 0 }
          : type === 'HEARTBEAT'
            ? { heartbeat: true }
            : undefined,
      rawSize: raw.rawSize,
      checksum: createHash('sha256').update(raw.payload).digest('hex'),
      direction: raw.direction,
    });
    return [msg];
  }

  public encode(cmd: DeviceCommand): Buffer {
    // Echo-style ack: same frame, type byte replaced by 0x00.
    const typeByte = cmd.type === 'LOGIN_ACK' ? 0x01 : cmd.type === 'HEARTBEAT_ACK' ? 0x1a : 0x00;
    const length = 1;
    const head = Buffer.alloc(HEADER + length);
    head[0] = MAGIC[0] ?? 0;
    head[1] = MAGIC[1] ?? 0;
    head[2] = (length >> 8) & 0xff;
    head[3] = length & 0xff;
    head[4] = typeByte;
    const crc = crc8(head.subarray(2));
    return Buffer.concat([head, Buffer.from([crc])]);
  }
}

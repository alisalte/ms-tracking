/**
 * Protocol Adapter contract (06 §9.1).
 *
 * The Protocol Abstraction Layer (PAL) is the contract between the transport
 * machinery (TCP/UDP servers) and vendor-specific decoders. Every adapter
 * implements the same interfaces, so the servers, session manager, and pipeline
 * are fully protocol-agnostic. Adding a protocol = adding one adapter module —
 * no core changes (06 §1.2 goal).
 */
import type { DeviceMessage, MessageType } from '../../domain/device-message.js';
import type { RawPacket } from '../../domain/raw-packet.js';
import type { ByteReader, NeedMore } from '../transport/byte-reader.js';

/** Static metadata describing a protocol (06 §2.1 catalog). */
export interface ProtocolMeta {
  /** Human-readable name, e.g. "GT06 / Concox". */
  readonly name: string;
  /** Default listen port (06 §2.1). */
  readonly defaultPort: number;
  /** Transport the protocol primarily uses. */
  readonly transport: 'tcp' | 'udp' | 'both';
  /** Framing rule, e.g. "start 0x78 0x78, CRC-16, stop 0x0D 0x0A". */
  readonly framingType: string;
  /** Auth strategy summary, e.g. "Login 0x01 → 8-byte IMEI (BCD)". */
  readonly authStrategy: string;
  /** Known device models speaking this protocol. */
  readonly deviceModels: readonly string[];
}

/** Result of a peek-based detection on a multiplexed listener (06 §2.3). */
export interface DetectionResult {
  /** 0..1 confidence; the PAL picks the highest-confidence adapter above threshold. */
  readonly confidence: number;
}

/** Downstream command payload to encode back to the wire. */
export interface DeviceCommand {
  readonly deviceId: string;
  readonly type: MessageType | string;
  readonly payload: Record<string, unknown>;
}

/**
 * Every protocol adapter implements this contract (06 §9.1).
 *
 * Lifecycle: an adapter instance is shared across all connections of its
 * protocol (it is stateless except for static config); per-connection state lives
 * in the ByteReader + DeviceSession.
 */
export interface ProtocolAdapter {
  /** Stable adapter id, e.g. 'gt06' | 'jt808' | 'teltonika'. */
  readonly id: string;
  readonly meta: ProtocolMeta;

  /**
   * Peek the first N bytes to identify this protocol on a multiplexed listener
   * (06 §2.3). Returns a confidence score; the PAL selects the best match.
   */
  detect(peek: Buffer): DetectionResult;

  /**
   * Streaming frame parser (06 §10.1). Consumes bytes from `reader`, applies the
   * protocol's framing rule, verifies the checksum, and returns one complete
   * RawPacket. Returns NEED_MORE when a partial frame is buffered (the transport
   * awaits the next chunk). May throw ProtocolError on a malformed frame.
   */
  frame(reader: ByteReader, receivedAt: Date): RawPacket | NeedMore;

  /**
   * Decode a framed RawPacket into the canonical DeviceMessage(s). One frame may
   * yield several messages (e.g. a Teltonika AVL batch). The caller (dispatcher)
   * resolves the device/tenant post-auth; the adapter fills serialOrImei from
   * the wire and leaves deviceId/tenantId empty for LOGIN until resolved.
   */
  decode(raw: RawPacket): readonly DeviceMessage[];

  /** Encode a downstream command to wire bytes (06 §9.1). */
  encode(cmd: DeviceCommand): Buffer;
}

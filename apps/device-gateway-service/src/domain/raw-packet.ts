/**
 * RawPacket — a decoded-but-not-normalized protocol frame (06 §9.1, §11.1).
 *
 * Produced by an adapter's streaming `frame()` parser from the wire bytes; the
 * dispatcher's decode stage turns it into a canonical DeviceMessage. A RawPacket
 * is a value (no identity) — its `receivedAt` + `payload` fully describe it.
 */
export type Direction = 'INBOUND' | 'OUTBOUND';

export interface RawPacketProps {
  /** Adapter that framed this packet, e.g. 'gt06'. */
  readonly protocolId: string;
  /** The framed wire bytes (delimiters/checksum included as the adapter sees fit). */
  readonly payload: Buffer;
  /** Gateway receive time. */
  readonly receivedAt: Date;
  /** Inbound from device, or outbound (command) to device. */
  readonly direction: Direction;
}

export class RawPacket {
  public readonly protocolId: string;
  public readonly payload: Buffer;
  public readonly receivedAt: Date;
  public readonly direction: Direction;

  constructor(props: RawPacketProps) {
    this.protocolId = props.protocolId;
    this.payload = props.payload;
    this.receivedAt = props.receivedAt;
    this.direction = props.direction;
  }

  /** Wire size in bytes. */
  public get rawSize(): number {
    return this.payload.byteLength;
  }
}

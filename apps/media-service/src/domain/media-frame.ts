/**
 * Canonical MediaFrame — the normalized internal frame shape every protocol
 * adapter produces (09 §2.4).
 *
 * JT1078, RTSP, and RTMP frames are all decoded into this shape at the adapter.
 * The pipeline operates exclusively on MediaFrame; it never touches vendor bytes.
 */

/** Video/audio stream types (JT1078 stream-type codes in parentheses). */
export type StreamType = 'H264' | 'H265' | 'AAC' | 'OPUS' | 'G711' | 'G726';

/** JT1078 stream-type byte → canonical StreamType (09 §3.5). */
export const JT1078_STREAM_TYPE: Readonly<Record<number, StreamType>> = {
  98: 'H264',
  99: 'H265',
  100: 'AAC',
  106: 'G711',
  107: 'G726',
};

/** Frame kind: video or audio. */
export type FrameKind = 'video' | 'audio';

/** The source protocol that produced this frame. */
export type SourceProtocol = 'JT1078' | 'RTSP' | 'RTMP' | 'WebRTC';

/** Per-frame source metadata (protocol-specific fields, normalized). */
export interface SourceMeta {
  readonly protocol: SourceProtocol;
  /** JT1078 logical channel number (null for RTSP/RTMP). */
  readonly logicalChannel?: number;
  /** JT1078 alarm flag (true if an alarm was active when the frame was captured). */
  readonly alarmFlag?: boolean;
}

/**
 * The canonical media frame. Every adapter decodes vendor-specific bytes into
 * this shape; the pipeline (demuxer, router, recorder, SFU) operates on it.
 */
export interface MediaFrame {
  readonly channelId: string;
  readonly streamType: StreamType;
  readonly kind: FrameKind;
  /** Raw payload: NALU (video) or audio frame bytes. */
  readonly payload: Buffer;
  /** True for video I-frames (keyframes). */
  readonly isKeyframe: boolean;
  /** RTP timestamp (normalized to a monotonically increasing clock). */
  readonly timestamp: number;
  /** Wall-clock capture time (UTC — BCD Beijing time already normalized by adapter). */
  readonly wallClock: Date;
  readonly sourceMeta: SourceMeta;
  /** Sequence number within the stream. */
  readonly seq: number;
}

/**
 * Decode a JT1078 stream-type byte into a canonical StreamType.
 * Returns null for unknown/unsupported types.
 */
export function decodeStreamType(typeByte: number): StreamType | null {
  return JT1078_STREAM_TYPE[typeByte] ?? null;
}

/** Whether a StreamType is a video codec. */
export function isVideoStream(type: StreamType): boolean {
  return type === 'H264' || type === 'H265';
}

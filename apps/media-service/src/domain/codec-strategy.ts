import type { StreamType } from './media-frame.js';
/**
 * Codec strategy — the passthrough-vs-transcode decision (09 §6).
 *
 *   H.264 → passthrough for ALL delivery modes (browser-native).
 *   H.265 → passthrough for RECORDING (40% smaller, saves PB-scale storage).
 *         → transcode to H.264 for LIVE WebRTC (browsers can't decode H.265).
 *   AAC / G.711 / G.726 → transcode to Opus for LIVE (WebRTC needs Opus).
 *                       → passthrough for RECORDING.
 *   OPUS → passthrough for all modes.
 *
 * Pure functions — trivially testable. The media-router uses these to decide
 * whether to spin up a transcoder track.
 */
import type { StreamMode } from './stream-session.js';

export type CodecAction = 'passthrough' | 'transcode';

export interface CodecDecision {
  readonly action: CodecAction;
  /** The codec the consumer receives (after transcode if applicable). */
  readonly outputCodec: StreamType;
  /** Why this decision was made (for metrics/debugging). */
  readonly reason: string;
}

/** Codecs browsers can decode natively over WebRTC. */
const WEBRTC_VIDEO_NATIVE: ReadonlySet<StreamType> = new Set(['H264']);
const WEBRTC_AUDIO_NATIVE: ReadonlySet<StreamType> = new Set(['OPUS']);

/**
 * Decide whether to passthrough or transcode for a given delivery mode.
 * Pure function (09 §6.1).
 */
export function decideCodec(cameraCodec: StreamType, mode: StreamMode): CodecDecision {
  // Recording always gets the raw, pre-transcode codec (09 §4.3 invariant #2).
  if (mode === 'RECORD') {
    return {
      action: 'passthrough',
      outputCodec: cameraCodec,
      reason: 'recording preserves native codec',
    };
  }

  // Live/playback/AI paths go through the SFU → browser compatibility matters.
  const isVideo = cameraCodec === 'H264' || cameraCodec === 'H265';
  const isNative = isVideo
    ? WEBRTC_VIDEO_NATIVE.has(cameraCodec)
    : WEBRTC_AUDIO_NATIVE.has(cameraCodec);

  if (isNative) {
    return {
      action: 'passthrough',
      outputCodec: cameraCodec,
      reason: `${cameraCodec} is browser-native`,
    };
  }

  // Transcode to browser-compatible.
  const target: StreamType = isVideo ? 'H264' : 'OPUS';
  return {
    action: 'transcode',
    outputCodec: target,
    reason: `${cameraCodec} not WebRTC-compatible → transcode to ${target}`,
  };
}

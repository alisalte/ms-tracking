/**
 * RTSP adapter — control-flow + SDP codec detection for RTSP IP cameras
 * (09 §3.3).
 *
 * RTSP is a pull protocol: OPTIONS → DESCRIBE (returns SDP) → SETUP → PLAY → RTP
 * frames → TEARDOWN. The media-router owns the actual RTP socket; this module
 * provides the SDP parsing (codec/resolution detection) + the keepalive logic.
 *
 * Sprint 10: SDP parsing is real (extracts codec from `a=rtpmap` lines); the
 * transport control is the sequence template the media-router follows.
 */
import type { StreamType } from '../../domain/media-frame.js';

/** RTSP session lifecycle states (09 §3.8). */
export type RtspState = 'IDLE' | 'CONNECTING' | 'ACTIVE' | 'DEGRADED' | 'CLOSING' | 'CLOSED';

/** Parsed SDP result — codecs detected from the camera's DESCRIBE response. */
export interface SdpInfo {
  readonly videoCodec: StreamType | null;
  readonly audioCodec: StreamType | null;
  readonly resolution: string | null;
}

/** RTSP keepalive interval (09 §3.3). */
export const RTSP_KEEPALIVE_MS = 30_000;
/** Backoff schedule on keepalive failure (seconds). */
export const RTSP_BACKOFF_S = [1, 2, 5, 10] as const;

/**
 * Parse an SDP body (from DESCRIBE) to extract codec information.
 * SDP `a=rtpmap:<pt> <codec>/<clockrate>` lines carry the codec name.
 */
export function parseSdp(sdp: string): SdpInfo {
  let videoCodec: StreamType | null = null;
  let audioCodec: StreamType | null = null;
  let resolution: string | null = null;

  for (const line of sdp.split('\n')) {
    const trimmed = line.trim();
    // a=rtpmap:<payloadType> <codecName>/<clockRate>
    const rtpmap = trimmed.match(/^a=rtpmap:\d+\s+(\S+)\/\d+/i);
    if (rtpmap) {
      const name = rtpmap[1]?.toUpperCase() ?? '';
      const mapped = mapRtpCodec(name);
      if (mapped && !videoCodec) videoCodec = mapped;
      else if (mapped && !audioCodec) audioCodec = mapped;
    }
    // a=framerate / imageattr for resolution (simplified)
    const frameSize = trimmed.match(/a=framerate:\s*(\d+)/i);
    if (frameSize) resolution = `${frameSize[1]}fps`;
  }

  return { videoCodec, audioCodec, resolution };
}

/** Map RTP codec names to canonical StreamType. */
function mapRtpCodec(name: string): StreamType | null {
  const map: Record<string, StreamType> = {
    H264: 'H264',
    'H264/90000': 'H264',
    H265: 'H265',
    'H265/90000': 'H265',
    HEVC: 'H265',
    AAC: 'AAC',
    'MPEG4-GENERIC': 'AAC',
    OPUS: 'OPUS',
    'OPUS/48000': 'OPUS',
    PCMA: 'G711',
    PCMU: 'G711',
    G726: 'G726',
  };
  return map[name] ?? null;
}

/** The RTSP control sequence the media-router follows (09 §3.3). Documented. */
export const RTSP_SEQUENCE = [
  'OPTIONS',
  'DESCRIBE',
  'SETUP',
  'PLAY',
] as const;

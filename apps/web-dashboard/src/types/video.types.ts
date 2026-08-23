/**
 * Video / Live Video Monitoring domain types (UI-facing, camelCase).
 *
 * Mirrors the consumption-plane contracts documented in
 * `docs/specs/10_Live_Video.md` (the live-view architecture) and
 * `docs/modules/VideoPlatform.md` Appendix B (the REST API surface). The wire
 * (`*Wire`) snake_case variants will be added here when the `media-service` +
 * Socket.IO signaling backends land real endpoints; today the video wall reads
 * from static mock data (`mock/video-data.ts`) so the UI is fully demoable.
 *
 * Color semantics live in `theme/palette.ts` (`status.*`); the string keys
 * here (e.g. `'good'`, `'active'`) map to those tokens so the UI never
 * hardcodes hex values.
 */

// ── Channels ─────────────────────────────────────────────────────────────────

/** Camera mounting/orientation — selects the tile icon + i18n label. */
export type CameraFacing = 'forward' | 'driver' | 'rear' | 'cargo' | 'site';

/** Whether a channel belongs to a vehicle or a fixed site. */
export type ChannelSourceType = 'vehicle' | 'site';

/** Camera video codec — surfaces the H.265 transcode hint (10 §3.2). */
export type VideoCodec = 'H264' | 'H265';

/** A camera channel — the unit a wall tile binds to (VideoPlatform §3.2). */
export interface CameraChannel {
  id: string;
  /** Display label, e.g. "Truck-42 · Forward". */
  label: string;
  facing: CameraFacing;
  sourceType: ChannelSourceType;
  /** Owning vehicle/site id. */
  sourceId: string;
  /** Owning vehicle/site display label. */
  sourceLabel: string;
  codec: VideoCodec;
  /** Online = a source pull is possible right now. */
  online: boolean;
  /** Recording policy active on the channel (REC overlay, 10 §2.2). */
  recordingActive: boolean;
  /** AI bounding boxes available on the channel. */
  aiEnabled: boolean;
  /** Driver-facing camera — privacy/consent gated (INV-MED02). */
  cabinCam: boolean;
  /** Driver has consented (jurisdiction-aware); false disables the channel. */
  consentGiven: boolean;
  /**
   * Honest stream classification (Sprint 3):
   * - `real` — a real WebRTC stream from a live endpoint.
   * - `stub` — the synthetic canvas-generated demo stream.
   * - `unavailable` — channel exists but no stream session can be opened.
   */
  streamKind?: 'real' | 'stub' | 'unavailable';
  /**
   * Stream protocol (media-service wire). `MEITRACK_MDVR` channels use the
   * real live path: A9A command → device dialback → mdvr-streamer → JSMpeg.
   */
  protocol?: string;
  /** Platform device id owning this camera (command plane A9A/A9B target). */
  deviceId?: string;
  /** MDVR logical channel number (1–4 cameras), sent in the A9A struct. */
  logicalChannel?: number;
  /** Device IMEI (the mdvr-streamer WebSocket room key). */
  imei?: string;
}

// ── Streams ──────────────────────────────────────────────────────────────────

/** Simulcast quality layer — the quality selector (10 §2.3). */
export type StreamQuality = 'auto' | 'high' | 'medium' | 'low' | 'audio-only';

/** Stream lifecycle state — drives the tile overlay + ARIA live region. */
export type StreamState = 'idle' | 'connecting' | 'active' | 'degraded' | 'closed' | 'error';

/** Signal strength — from camera health + last-frame age (10 §2.4). */
export type Signal = 'good' | 'fair' | 'poor';

/**
 * A live stream session — the result of `POST /api/v1/media/streams`
 * (VideoPlatform Appendix B.3). The synthetic `MediaStream` (mock) or the
 * real `RTCPeerConnection` remote track (future) is attached separately by the
 * stream library so this type stays wire-shaped.
 */
export interface StreamSession {
  sessionId: string;
  channelId: string;
  quality: StreamQuality;
  /** Per-stream signaling token (opaque, 5-min sliding, 10 §5.4). */
  signalingToken: string;
  /** Signaling endpoint the Socket.IO client connects to. */
  websocketUrl: string;
  state: StreamState;
  /** Glass-to-glass latency in ms (RTCP-derived in production; simulated mock). */
  latencyMs: number;
  signal: Signal;
  /** ISO timestamp the session opened. */
  startedAt: string;
}

// ── Video Wall ───────────────────────────────────────────────────────────────

/**
 * Wall grid division — the number of tiles the viewport splits into.
 *
 * All values are perfect squares (1,2,3,4,6,8)² so the grid is always square:
 * 1 → 1×1, 4 → 2×2, 9 → 3×3, 16 → 4×4, 36 → 6×6, 64 → 8×8. Matches the
 * HikCentral-style division presets (VideoPlatform §10.2).
 */
export type WallDivision = 1 | 4 | 9 | 16 | 36 | 64;

/** The complete set of wall division presets (UI toolbar renders these). */
export const WALL_DIVISIONS: readonly WallDivision[] = [1, 4, 9, 16, 36, 64] as const;

/**
 * Maximum concurrent live streams a wall will sustain before switching to
 * placeholder + round-robin rotation (10 §6.3, VideoPlatform §10.2.2 — the
 * wired-NOC tier). 36/64 layouts exceed this and rotate the overflow.
 */
export const MAX_LIVE_TILES = 16;

/** Round-robin rotation interval for non-pinned overflow tiles (§10.2.1). */
export const WALL_ROTATION_MS = 30_000;

/** A single wall slot — its position + the channel bound to it. */
export interface WallTile {
  /** Zero-based slot index within the grid. */
  slot: number;
  /** Bound channel id, or null for an empty slot. */
  channelId: string | null;
  /** Pinned tiles are exempt from round-robin rotation. */
  pinned: boolean;
}

/** A saved wall layout (VideoPlatform §10.2.1 `VideoWallLayout`). */
export interface VideoWall {
  id: string;
  name: string;
  division: WallDivision;
  /** Ordered slots — index === slot. */
  tiles: WallTile[];
}

/**
 * Live-stream library — the seam between the UI and the media plane.
 *
 * Today this is a **mock** producer: each channel's video is a synthetic
 * `MediaStream` drawn on an offscreen `<canvas>` (animated scene + live clock +
 * simulated AI boxes) and exposed via `canvas.captureStream()`. This is the
 * *exact* type a real `RTCPeerConnection` remote track yields, so the player
 * and tiles are already wired to the production contract.
 *
 * Swap path (when `media-service` + Socket.IO land): replace the mock body of
 * `openStream` with a real `RTCPeerConnection` + `MediaSignalingClient`
 * (Socket.IO) negotiation; the returned `MediaStream` plugs into the same
 * `video.srcObject` and the UI is unchanged.
 */
import type { CameraChannel, StreamQuality } from '@/types/video.types';

/** Options controlling the synthetic stream. */
export interface MockStreamOptions {
  /** Whether to add a faint ambient audio track (unmuting is audible). */
  audio?: boolean;
}

/** A live stream handle — the mock's analog of an RTCPeerConnection. */
export interface StreamHandle {
  /** The MediaStream to attach to `<video>`. */
  stream: MediaStream;
  /** Tear down the canvas animation + audio node. */
  close(): void;
}

/** Palette for the synthetic scene — semantic-ish, theme-agnostic. */
const SCENE = {
  sky: '#0b1220',
  road: '#1f2937',
  lane: '#e5e7eb',
  accent: '#22d3ee',
  warn: '#fb7185',
  text: '#e5e7eb',
} as const;

/**
 * Build a synthetic MediaStream for a channel.
 *
 * Draws a moving road scene + channel label + live clock + a drifting AI
 * bounding box so latency/quality/snapshot/fullscreen all exercise real pixels.
 * The canvas is sized to the quality layer so the bitrate hint is believable.
 */
function createMockStream(channel: CameraChannel, quality: StreamQuality): StreamHandle {
  const widths: Record<StreamQuality, number> = {
    high: 1280,
    medium: 960,
    low: 640,
    auto: 960,
    'audio-only': 320,
  };
  const width = widths[quality] ?? 960;
  const height = Math.round((width * 9) / 16);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  let frame = 0;
  let raf = 0;

  function draw() {
    if (!ctx) return;
    frame += 1;
    const t = frame;

    // Sky + ground.
    ctx.fillStyle = SCENE.sky;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = SCENE.road;
    ctx.fillRect(0, Math.round(height * 0.55), width, Math.round(height * 0.45));

    // Lane markings scrolling toward the viewer.
    ctx.fillStyle = SCENE.lane;
    const laneW = Math.max(6, Math.round(width * 0.02));
    for (let i = 0; i < 6; i++) {
      const phase = (t * 6 + i * 90) % 360;
      const y = Math.round(height * 0.55 + (phase / 360) * height * 0.45);
      ctx.fillRect(
        Math.round(width / 2 - laneW / 2),
        y,
        laneW,
        Math.max(10, Math.round(height * 0.05)),
      );
    }

    // Simulated AI bounding box (FCW object) drifting across the road.
    const boxX = Math.round(width * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t / 45))));
    const boxY = Math.round(height * 0.62);
    const boxW = Math.max(40, Math.round(width * 0.12));
    const boxH = Math.max(30, Math.round(height * 0.16));
    ctx.strokeStyle = SCENE.warn;
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Channel label (top-left).
    ctx.fillStyle = SCENE.text;
    ctx.font = `${Math.max(14, Math.round(height * 0.06))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(channel.label, 12, Math.round(height * 0.1));

    // Live clock (top-right) — proves the frame is "live".
    const clock = new Date().toLocaleTimeString([], { hour12: false });
    const clockW = ctx.measureText(clock).width;
    ctx.fillStyle = SCENE.accent;
    ctx.fillText(clock, width - clockW - 12, Math.round(height * 0.1));

    // REC dot if recording.
    if (channel.recordingActive) {
      ctx.fillStyle = SCENE.warn;
      ctx.beginPath();
      ctx.arc(
        width - 16,
        Math.round(height * 0.2),
        Math.max(4, Math.round(height * 0.02)),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    raf = requestAnimationFrame(draw);
  }
  draw();

  const stream = (canvas as HTMLCanvasElement).captureStream(24);

  return {
    stream,
    close() {
      cancelAnimationFrame(raf);
      for (const tr of stream.getTracks()) tr.stop();
    },
  };
}

/**
 * Resolve a synthetic ambient audio track for a channel.
 *
 * Returns null where WebAudio is unavailable (older browsers / jsdom tests).
 * Created lazily so nothing autoplays until the viewer un-mutes (autoplay policy).
 */
export function createAmbientAudioTrack(_channel: CameraChannel): MediaStreamTrack | null {
  const Ctor = (
    globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  ).AudioContext;
  const WkCtor = (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const AudioCtor = Ctor ?? WkCtor;
  if (!AudioCtor) return null;
  try {
    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 110; // low hum
    const gain = ctx.createGain();
    gain.gain.value = 0.02; // very faint
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    const dest = ctx.createMediaStreamDestination();
    gain.connect(dest);
    return dest.stream.getAudioTracks()[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Open a mock stream for a channel + quality.
 *
 * The `MediaSignalingClient` swap point: in production this delegates to a real
 * `RTCPeerConnection` negotiation driven by the Socket.IO signaling client; the
 * returned `MediaStream` plugs into the same `<video>`.
 */
export function openStream(
  channel: CameraChannel,
  quality: StreamQuality,
  options: MockStreamOptions = {},
): StreamHandle {
  const handle = createMockStream(channel, quality);
  if (options.audio) {
    const track = createAmbientAudioTrack(channel);
    if (track) handle.stream.addTrack(track);
  }
  return handle;
}

/**
 * Capture a JPEG snapshot from a playing <video> element.
 *
 * Draws the current frame to a 2D canvas and returns a Blob ready for download
 * (maps to `POST /api/v1/media/channels/{id}/snapshot`, VideoPlatform Appendix B).
 * Returns null if the video has no readable frame yet.
 */
export async function captureSnapshot(video: HTMLVideoElement): Promise<Blob | null> {
  if (!video.videoWidth && !video.videoHeight) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 960;
  canvas.height = video.videoHeight || 540;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
}

/** Trigger a browser download for a blob + filename (snapshot save). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Enter fullscreen on an element, exiting if already fullscreen.
 *
 * Vendor-prefixed for Safari (`webkitRequestFullscreen`). No-op where the API
 * is unavailable (jsdom).
 */
export async function toggleFullscreen(el: HTMLElement): Promise<void> {
  const doc = document as Document & {
    webkitFullscreenElement?: Element;
    webkitExitFullscreen?: () => Promise<void>;
  };
  const element = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };

  if (document.fullscreenElement || doc.webkitFullscreenElement) {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    return;
  }
  if (el.requestFullscreen) await el.requestFullscreen();
  else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
}

/** Subscribe to fullscreen changes (enter/exit). Returns an unsubscribe fn. */
export function onFullscreenChange(handler: () => void): () => void {
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
  };
}

/** Whether any element is currently fullscreen. */
export function isFullscreen(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element };
  return Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
}

// ── Signaling client (Socket.IO swap point) ──────────────────────────────────

/**
 * The signaling + control channel contract (10 §4.2 message catalog).
 *
 * `MockMediaSignalingClient` simulates the negotiation lifecycle (offer →
 * answer → ICE → ACTIVE). When Socket.IO lands, `SocketSignalingClient` drops
 * in behind this interface and the player is unchanged.
 */
export interface MediaSignalingClient {
  connect(token: string, websocketUrl: string): Promise<void>;
  /** Resolve once the simulated offer/answer/ICE round-trip completes. */
  negotiate(sessionId: string): Promise<{ latencyMs: number; signal: 'good' | 'fair' | 'poor' }>;
  changeQuality(sessionId: string, quality: StreamQuality): Promise<void>;
  close(sessionId: string): Promise<void>;
  disconnect(): void;
}

/** Simulated signaling latency so the "connecting" overlay is visible. */
const NEGOTIATION_MS = 450;

/**
 * Mock signaling client — drives the session state machine without a server.
 *
 * Used by `useStreamSession` to advance `connecting → active` and to emit
 * believable latency/signal stats. Replace with `SocketSignalingClient` when
 * the `media-service` Socket.IO endpoint ships.
 */
export class MockMediaSignalingClient implements MediaSignalingClient {
  private readonly live = new Set<string>();

  async connect(_token: string, _websocketUrl: string): Promise<void> {
    // Mock: handshake always succeeds (the token was already minted by REST).
  }

  async negotiate(
    sessionId: string,
  ): Promise<{ latencyMs: number; signal: 'good' | 'fair' | 'poor' }> {
    await new Promise((r) => setTimeout(r, NEGOTIATION_MS));
    this.live.add(sessionId);
    // Believable sub-second glass-to-glass latency (10 §1.5 budget).
    const latencyMs = 380 + Math.round(Math.random() * 420);
    const signal = latencyMs < 550 ? 'good' : latencyMs < 800 ? 'fair' : 'poor';
    return { latencyMs, signal };
  }

  async changeQuality(_sessionId: string, _quality: StreamQuality): Promise<void> {
    // Mock: simulcast layer switch is instant.
  }

  async close(sessionId: string): Promise<void> {
    this.live.delete(sessionId);
  }

  disconnect(): void {
    this.live.clear();
  }
}

// ── JSMpeg live player (MDVR real streams) ───────────────────────────────────

/** The subset of the vendored JSMpeg API the live player uses. */
interface JSMpegPlayer {
  destroy(): void;
  pause(): void;
  play(): void;
}

interface JSMpegStatic {
  Player: new (
    url: string,
    options: {
      canvas: HTMLCanvasElement;
      autoplay?: boolean;
      audio?: boolean;
      loop?: boolean;
      videoBufferSize?: number;
      disableWebAssembly?: boolean;
      onSourceEstablished?: () => void;
      onPlay?: () => void;
    },
  ) => JSMpegPlayer;
}

declare global {
  interface Window {
    JSMpeg?: JSMpegStatic;
  }
}

let jsmpegLoad: Promise<JSMpegStatic> | null = null;

/**
 * Load the vendored JSMpeg bundle (`public/jsmpeg.min.js`) exactly once and
 * resolve its global. JSMpeg decodes low-latency MPEG-TS (H.264 baseline)
 * on a canvas — the same player the standalone MD300 pipeline validated.
 */
export function loadJSMpeg(): Promise<JSMpegStatic> {
  if (jsmpegLoad) return jsmpegLoad;
  jsmpegLoad = new Promise((resolve, reject) => {
    if (window.JSMpeg) {
      resolve(window.JSMpeg);
      return;
    }
    const script = document.createElement('script');
    script.src = '/jsmpeg.min.js';
    script.async = true;
    script.onload = () => {
      if (window.JSMpeg) resolve(window.JSMpeg);
      else reject(new Error('jsmpeg.min.js loaded but window.JSMpeg is missing'));
    };
    script.onerror = () => {
      jsmpegLoad = null;
      reject(new Error('failed to load /jsmpeg.min.js'));
    };
    document.head.appendChild(script);
  });
  return jsmpegLoad;
}

/** Options driving one JSMpeg player instance. */
export interface JSMpegStreamOptions {
  /** Fires when the WebSocket source is established (connection open). */
  onSourceEstablished?: () => void;
  /** Fires when decoding + rendering actually start. */
  onPlay?: () => void;
}

/**
 * Start a JSMpeg player for a binary MPEG-TS WebSocket (`…/media-live/ws?imei=…`).
 * Returns the player handle — the caller keeps ownership of the canvas.
 */
export async function startJSMpegPlayer(
  wsUrl: string,
  canvas: HTMLCanvasElement,
  options: JSMpegStreamOptions = {},
): Promise<JSMpegPlayer> {
  const JSMpeg = await loadJSMpeg();
  return new JSMpeg.Player(wsUrl, {
    canvas,
    autoplay: true,
    loop: true,
    audio: false, // the streamer's TS output is video-only (-an)
    videoBufferSize: 512 * 1024,
    // Pure-JS decoder: the WASM module is fetched relative to the page and we
    // only vendor jsmpeg.min.js (no jsmpeg.wasm) — a 404 there leaves the
    // decoder dead and the canvas never initializes.
    disableWebAssembly: true,
    onSourceEstablished: options.onSourceEstablished,
    onPlay: options.onPlay,
  });
}

/** Capture a JPEG snapshot from a live JSMpeg canvas. */
export function captureCanvasSnapshot(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (!canvas.width || !canvas.height) return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
}

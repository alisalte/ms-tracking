/**
 * useStreamSession — own the live-stream lifecycle for one tile.
 *
 * Drives the full flow documented in `10_Live_Video.md` §3.1: mock-REST mints
 * the session, the mock signaling client advances `connecting → active`, and
 * the stream library produces a synthetic `MediaStream` to attach to `<video>`.
 * Tears down cleanly on unmount or when the channel/quality changes (idle
 * auto-close, 10 §2.5).
 *
 * Swap path: replace the mock body with `apiPost('/media/streams')` + a real
 * `RTCPeerConnection` driven by `MediaSignalingClient` (Socket.IO). The hook's
 * return shape stays the same so the tile/player are unchanged.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { MockMediaSignalingClient, type StreamHandle, openStream } from '@/lib/video-stream';
import { mockStreamSession } from '@/mock/video-data';
import type { CameraChannel, StreamQuality, StreamSession } from '@/types/video.types';

export interface StreamSessionHook {
  /** Session metadata (state, latency, signal) or null before open. */
  session: StreamSession | null;
  /** The MediaStream to attach to the <video>, or null while connecting. */
  stream: MediaStream | null;
  /** Switch the simulcast layer (10 §2.3). */
  setQuality: (q: StreamQuality) => void;
}

/** Heartbeat interval for live latency/signal refresh (simulated). */
const STATS_REFRESH_MS = 2000;

/**
 * @param channel The camera channel to stream, or null to stay idle.
 * @param quality Initial simulcast layer.
 */
export function useStreamSession(
  channel: CameraChannel | null,
  quality: StreamQuality = 'auto',
): StreamSessionHook {
  const [session, setSession] = useState<StreamSession | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [currentQuality, setCurrentQuality] = useState<StreamQuality>(quality);

  // Refs hold the live resources so cleanup always closes the right handle.
  const handleRef = useRef<StreamHandle | null>(null);
  const signalingRef = useRef(new MockMediaSignalingClient());
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStats = useCallback(() => {
    if (statsTimerRef.current !== null) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    stopStats();
    if (handleRef.current) {
      handleRef.current.close();
      handleRef.current = null;
    }
    setStream(null);
    setSession((prev) => (prev ? { ...prev, state: 'closed' } : prev));
  }, [stopStats]);

  // Open / re-open whenever the channel or quality changes.
  useEffect(() => {
    if (!channel) {
      teardown();
      setSession(null);
      return;
    }
    if (!channel.online || !channel.consentGiven) {
      teardown();
      setSession(null);
      return;
    }

    let cancelled = false;
    // Mint the session (mock POST /streams) and start connecting.
    const initial = mockStreamSession(channel, currentQuality);
    setSession(initial);

    // Open the synthetic MediaStream immediately so the player can attach.
    handleRef.current = openStream(channel, currentQuality, { audio: true });
    setStream(handleRef.current.stream);

    // Drive the negotiation lifecycle via the (mock) signaling client.
    signalingRef.current
      .connect(initial.signalingToken, initial.websocketUrl)
      .then(() => signalingRef.current.negotiate(initial.sessionId))
      .then(({ latencyMs, signal }) => {
        if (cancelled) return;
        setSession({ ...initial, state: 'active', latencyMs, signal });

        // Refresh live stats on a heartbeat so the latency badge feels alive.
        stopStats();
        statsTimerRef.current = setInterval(() => {
          setSession((prev) => {
            if (!prev) return prev;
            const jitter = Math.round((Math.random() - 0.5) * 120);
            const nextLatency = Math.max(300, prev.latencyMs + jitter);
            const nextSignal = nextLatency < 550 ? 'good' : nextLatency < 800 ? 'fair' : 'poor';
            return { ...prev, latencyMs: nextLatency, signal: nextSignal };
          });
        }, STATS_REFRESH_MS);
      });

    return () => {
      cancelled = true;
      teardown();
    };
  }, [channel, currentQuality, teardown, stopStats]);

  const setQuality = useCallback((q: StreamQuality) => {
    setCurrentQuality(q);
    // The effect above re-runs (new quality → re-open); in production this is
    // an in-band simulcast layer switch with no re-pull.
  }, []);

  return { session, stream, setQuality };
}

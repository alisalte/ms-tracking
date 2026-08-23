/**
 * useStreamSession — own the live-stream lifecycle for one tile.
 *
 * Two paths share this hook:
 *
 *  1. MDVR (real) — channels with `protocol === 'MEITRACK_MDVR'` + a bound
 *     deviceId/imei. The hook sends the A9A command through the platform
 *     command path (fleet-management → Kafka → device-gateway → device), then
 *     exposes the mdvr-streamer's binary MPEG-TS WebSocket URL for the
 *     JSMpeg canvas player. Teardown sends A9B (stop).
 *
 *  2. Mock — every other channel: a synthetic canvas `MediaStream` driven by
 *     the MockMediaSignalingClient (honestly labelled DEMO by the tile).
 *
 * v2 enhancements (both paths): connection timeout, error state, automatic
 * reconnect with backoff, and cleanup guarantees.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiPost } from '@/api/client';
import { mdvrStreamEndpoint, mdvrWsUrl } from '@/api/video.api';
import { MockMediaSignalingClient, type StreamHandle, openStream } from '@/lib/video-stream';
import { mockStreamSession } from '@/mock/video-data';
import type { CameraChannel, StreamQuality, StreamSession } from '@/types/video.types';

export interface StreamSessionHook {
  /** Session metadata (state, latency, signal) or null before open. */
  session: StreamSession | null;
  /** The synthetic MediaStream (mock path), or null while connecting. */
  stream: MediaStream | null;
  /** Binary MPEG-TS WebSocket URL (MDVR path) for the JSMpeg canvas player. */
  wsUrl: string | null;
  /** Which player the tile should mount for this session. */
  mode: 'mdvr' | 'mock' | null;
  /**
   * Honest stream classification:
   * - `stub` — synthetic canvas stream (mock path).
   * - `real` — the MDVR media plane (A9A → dialback → mdvr-streamer).
   * - `unavailable` — the session could not be opened.
   */
  streamKind: 'real' | 'stub' | 'unavailable';
  /** Switch the simulcast layer (10 §2.3). */
  setQuality: (q: StreamQuality) => void;
  /** Manually retry the connection (after an error). */
  retry: () => void;
  /** MDVR path: the JSMpeg player reports decoding started. */
  onPlayerReady: () => void;
}

/** Heartbeat interval for live latency/signal refresh (simulated, mock path). */
const STATS_REFRESH_MS = 2000;

/** Connection timeout — if the stream doesn't start in 15s, fail + retry. */
const CONNECTION_TIMEOUT_MS = 15_000;

/** Max automatic reconnect attempts. */
const MAX_RETRIES = 3;

/** Base backoff delay for reconnect. */
const RECONNECT_BASE_MS = 1000;

/** A channel is live-streamable through the MDVR media plane. */
export function isMdvrChannel(channel: CameraChannel | null): boolean {
  return Boolean(
    channel && channel.protocol === 'MEITRACK_MDVR' && channel.deviceId && channel.imei,
  );
}

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
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [currentQuality, setCurrentQuality] = useState<StreamQuality>(quality);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [errorState, setErrorState] = useState(false);

  const mdvr = isMdvrChannel(channel);
  const mode: 'mdvr' | 'mock' | null = channel ? (mdvr ? 'mdvr' : 'mock') : null;

  const handleRef = useRef<StreamHandle | null>(null);
  const signalingRef = useRef(new MockMediaSignalingClient());
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const channelRef = useRef<CameraChannel | null>(channel);
  channelRef.current = channel;

  const stopTimers = useCallback(() => {
    if (statsTimerRef.current !== null) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    if (timeoutTimerRef.current !== null) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    stopTimers();
    if (handleRef.current) {
      handleRef.current.close();
      handleRef.current = null;
    }
    setStream(null);
    setWsUrl(null);
    setSession((prev) => (prev ? { ...prev, state: 'closed' } : prev));
  }, [stopTimers]);

  /** Schedule an automatic reconnect with exponential backoff. */
  const scheduleReconnect = useCallback(() => {
    if (retryCountRef.current >= MAX_RETRIES) {
      setSession((prev) => (prev ? { ...prev, state: 'error' } : prev));
      setErrorState(true);
      return;
    }
    const delay = RECONNECT_BASE_MS * 2 ** retryCountRef.current;
    retryCountRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => setRetryTrigger((n) => n + 1), delay);
  }, []);

  /** Fire-and-forget A9B stop so the device tears down its media channel. */
  const stopMdvr = useCallback(() => {
    const ch = channelRef.current;
    if (!ch?.deviceId || !ch.logicalChannel) return;
    void apiPost(`/devices/${ch.deviceId}/commands`, {
      commandCode: 'A9B',
      params: { channel: ch.logicalChannel, control: '0', closeType: '0', switchType: '0' },
    }).catch(() => {
      /* best-effort — the device also stops on disconnect */
    });
  }, []);

  // Open / re-open whenever the channel, quality, or retry trigger changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: teardown/stopTimers/scheduleReconnect/stopMdvr use stable refs
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
    const initial = mockStreamSession(channel, currentQuality);
    setSession(initial);

    // ── MDVR real path ──────────────────────────────────────────────────────
    if (mdvr) {
      const endpoint = mdvrStreamEndpoint();
      timeoutTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        teardown();
        setSession((prev) => (prev ? { ...prev, state: 'error' } : prev));
        scheduleReconnect();
      }, CONNECTION_TIMEOUT_MS);

      void apiPost(`/devices/${channel.deviceId}/commands`, {
        commandCode: 'A9A',
        params: {
          server: endpoint.server,
          tcpPort: endpoint.tcpPort,
          udpPort: 0,
          channel: channel.logicalChannel ?? 1,
          dataType: '1', // video only
          streamType: '1', // minor (sub) stream — the bandwidth-friendly default
        },
      })
        .then(() => {
          if (cancelled) return;
          // Command accepted → the device will dial the streamer; open the
          // player socket now. Decoding "active" is reported by onPlayerReady.
          setWsUrl(mdvrWsUrl(channel.imei ?? ''));
        })
        .catch(() => {
          if (cancelled) return;
          teardown();
          setSession((prev) => (prev ? { ...prev, state: 'error' } : prev));
          scheduleReconnect();
        });

      return () => {
        cancelled = true;
        stopMdvr();
        teardown();
      };
    }

    // ── Mock path ───────────────────────────────────────────────────────────
    // Open the synthetic MediaStream immediately so the player can attach.
    handleRef.current = openStream(channel, currentQuality, { audio: true });
    setStream(handleRef.current.stream);

    // Connection timeout — if negotiation doesn't complete, fail + retry.
    timeoutTimerRef.current = setTimeout(() => {
      if (cancelled) return;
      if (handleRef.current) {
        handleRef.current.close();
        handleRef.current = null;
      }
      setStream(null);
      setSession((prev) => (prev ? { ...prev, state: 'error' } : prev));
      scheduleReconnect();
    }, CONNECTION_TIMEOUT_MS);

    // Drive the negotiation lifecycle via the (mock) signaling client.
    signalingRef.current
      .connect(initial.signalingToken, initial.websocketUrl)
      .then(() => signalingRef.current.negotiate(initial.sessionId))
      .then(({ latencyMs, signal }) => {
        if (cancelled) return;
        // Clear the timeout — negotiation succeeded.
        if (timeoutTimerRef.current !== null) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        retryCountRef.current = 0;
        setSession({ ...initial, state: 'active', latencyMs, signal });

        // Refresh live stats on a heartbeat so the latency badge feels alive.
        stopTimers();
        statsTimerRef.current = setInterval(() => {
          setSession((prev) => {
            if (!prev) return prev;
            const jitter = Math.round((Math.random() - 0.5) * 120);
            const nextLatency = Math.max(300, prev.latencyMs + jitter);
            const nextSignal = nextLatency < 550 ? 'good' : nextLatency < 800 ? 'fair' : 'poor';
            return { ...prev, latencyMs: nextLatency, signal: nextSignal };
          });
        }, STATS_REFRESH_MS);
      })
      .catch(() => {
        if (cancelled) return;
        teardown();
        setSession((prev) => (prev ? { ...prev, state: 'error' } : prev));
        scheduleReconnect();
      });

    return () => {
      cancelled = true;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, currentQuality, retryTrigger, mdvr]);

  /** MDVR path: called by the JSMpeg player when decoding actually starts. */
  const onPlayerReady = useCallback(() => {
    if (timeoutTimerRef.current !== null) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    retryCountRef.current = 0;
    setSession((prev) => (prev ? { ...prev, state: 'active' } : prev));
  }, []);

  const setQuality = useCallback((q: StreamQuality) => {
    setCurrentQuality(q);
  }, []);

  /** Manual retry — resets the retry counter and re-triggers the effect. */
  const retry = useCallback(() => {
    retryCountRef.current = 0;
    setRetryTrigger((n) => n + 1);
  }, []);

  const streamKind: 'real' | 'stub' | 'unavailable' = errorState
    ? 'unavailable'
    : channel
      ? mdvr
        ? 'real'
        : 'stub'
      : 'unavailable';

  return { session, stream, wsUrl, mode, streamKind, setQuality, retry, onPlayerReady };
}

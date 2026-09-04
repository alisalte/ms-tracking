/**
 * useStreamSession — own the live-stream lifecycle for one tile.
 *
 * Two paths share this hook:
 *
 *  1. MDVR (real) — channels with `protocol === 'MEITRACK_MDVR'` + a bound
 *     deviceId/imei. The hook sends the AB2 command through the platform
 *     command path (fleet-management → Kafka → device-gateway → device), then
 *     exposes the MediaMTX HLS URL for the HLS.js player. Teardown sends AB3.
 *
 *  2. Mock — every other channel: a synthetic canvas `MediaStream` driven by
 *     the MockMediaSignalingClient (honestly labelled DEMO by the tile).
 *
 * v2 enhancements (both paths): connection timeout, error state, automatic
 * reconnect with backoff, and cleanup guarantees.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiPost } from '@/api/client';
import { mdvrHlsUrl, mdvrRtmpUploadUrl } from '@/api/video.api';
import { MockMediaSignalingClient, type StreamHandle, openStream } from '@/lib/video-stream';
import { mockStreamSession } from '@/mock/video-data';
import type { DeviceCommandRecord } from '@/types/command.types';
import type { CameraChannel, StreamQuality, StreamSession } from '@/types/video.types';

/** Console tag so `[MDVR]` is easy to filter/search in devtools. */
function mdvrLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[MDVR]', ...args);
}

export interface StreamSessionHook {
  /** Session metadata (state, latency, signal) or null before open. */
  session: StreamSession | null;
  /** The synthetic MediaStream (mock path), or null while connecting. */
  stream: MediaStream | null;
  /** HLS playlist URL (MDVR path) for the HLS.js player. */
  hlsUrl: string | null;
  /** Which player the tile should mount for this session. */
  mode: 'mdvr' | 'mock' | null;
  /**
   * Honest stream classification:
   * - `stub` — synthetic canvas stream (mock path).
   * - `real` — the MDVR media plane (AB2 → RTMP → MediaMTX HLS).
   * - `unavailable` — the session could not be opened.
   */
  streamKind: 'real' | 'stub' | 'unavailable';
  /** Switch the simulcast layer (10 §2.3). */
  setQuality: (q: StreamQuality) => void;
  /** Manually retry the connection (after an error). */
  retry: () => void;
  /** MDVR path: the HLS player reports the playlist is ready. */
  onPlayerReady: () => void;
}

/** Heartbeat interval for live latency/signal refresh (simulated, mock path). */
const STATS_REFRESH_MS = 2000;

/** Connection timeout — RTMP ingest from the device can take ~10–20s; GPRS may lag. */
const CONNECTION_TIMEOUT_MS = 120_000;

/** Max automatic reconnect attempts. */
const MAX_RETRIES = 3;

/** Base backoff delay for reconnect. */
const RECONNECT_BASE_MS = 1000;

/** One AB2/AB3 pair per IMEI — four wall tiles must not start four pushes. */
type MdvrShare = { count: number; start: Promise<void> };
const mdvrShares = new Map<string, MdvrShare>();
/** In-flight AB3 so a reconnect cannot send AB2 before stop is queued. */
const mdvrStopping = new Map<string, Promise<void>>();

function acquireMdvrLive(imei: string, start: () => Promise<void>): Promise<void> {
  const existing = mdvrShares.get(imei);
  if (existing) {
    existing.count += 1;
    return existing.start;
  }
  const afterStop = mdvrStopping.get(imei) ?? Promise.resolve();
  const share: MdvrShare = {
    count: 1,
    start: afterStop.catch(() => undefined).then(() => start()),
  };
  mdvrShares.set(imei, share);
  share.start.catch(() => {
    if (mdvrShares.get(imei) === share) mdvrShares.delete(imei);
  });
  return share.start;
}

function releaseMdvrLive(imei: string, stop: () => Promise<void>): void {
  const existing = mdvrShares.get(imei);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count > 0) return;
  mdvrShares.delete(imei);
  const stopping = stop().catch(() => undefined);
  mdvrStopping.set(imei, stopping);
  void stopping.finally(() => {
    if (mdvrStopping.get(imei) === stopping) mdvrStopping.delete(imei);
  });
}

/** Poll until the gateway actually wrote AB2 (QUEUED → SENT). HELD stays QUEUED. */
async function waitForAb2OnWire(
  commandId: string,
  isCancelled: () => boolean,
): Promise<'SENT' | 'ACKED' | 'QUEUED' | 'FAILED'> {
  for (let i = 0; i < 45; i++) {
    if (isCancelled()) return 'QUEUED';
    try {
      const rec = await apiGet<DeviceCommandRecord>(`/device-commands/${commandId}`);
      if (i === 0 || i % 5 === 0 || rec.status !== 'QUEUED') {
        mdvrLog(`AB2 ${commandId} status=${rec.status}`);
      }
      if (rec.status === 'SENT' || rec.status === 'ACKED') return rec.status;
      if (rec.status === 'FAILED' || rec.status === 'EXPIRED') return 'FAILED';
    } catch (err) {
      if (i === 0 || i % 5 === 0) mdvrLog('AB2 status poll error:', err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  mdvrLog(
    `AB2 ${commandId} still QUEUED — device-gateway has not written it (GPRS socket is not AUTHENTICATED; command is HELD).`,
  );
  return 'QUEUED';
}

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
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
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
    setHlsUrl(null);
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

  /** Fire-and-forget AB3 stop so the device tears down its RTMP push. */
  const stopMdvr = useCallback(async () => {
    const ch = channelRef.current;
    if (!ch?.deviceId) return;
    mdvrLog(`AB3 stop → device=${ch.deviceId} imei=${ch.imei ?? '?'}`);
    try {
      await apiPost(`/devices/${ch.deviceId}/commands`, {
        commandCode: 'AB3',
        // md300-main live.js always stops channel 1 (the only working AV channel).
        params: { channel: 1, control: '0', closeType: '0', switchType: '0' },
      });
      mdvrLog(`AB3 accepted for device=${ch.deviceId}`);
    } catch (err) {
      mdvrLog(`AB3 failed for device=${ch.deviceId} (best-effort):`, err);
    }
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
      const imei = channel.imei ?? '';
      const deviceId = channel.deviceId ?? '';
      const uploadUrl = mdvrRtmpUploadUrl(imei);
      const url = mdvrHlsUrl(imei);
      mdvrLog(
        `opening channel=${channel.id} device=${deviceId} imei=${imei} → AB2 uploadUrl=${uploadUrl} hlsUrl=${url}`,
      );

      timeoutTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        mdvrLog(
          `TIMEOUT (${CONNECTION_TIMEOUT_MS}ms) waiting for stream — device=${deviceId} imei=${imei}. Check: is the device connected to device-gateway (AUTHENTICATED)? Is AB2 still HELD (see device-gateway logs)? Is the device pushing RTMP to :1935?`,
        );
        teardown();
        setSession((prev) => (prev ? { ...prev, state: 'error' } : prev));
        scheduleReconnect();
      }, CONNECTION_TIMEOUT_MS);

      void acquireMdvrLive(imei, async () => {
        mdvrLog(`POST /devices/${deviceId}/commands AB2`, {
          uploadUrl,
          channel: 1,
          dataType: '0',
          streamType: '0',
        });
        const record = await apiPost<
          { commandCode: string; params: Record<string, string | number> },
          DeviceCommandRecord
        >(`/devices/${deviceId}/commands`, {
          commandCode: 'AB2',
          params: {
            uploadUrl,
            // md300-main live.js CHANNEL=1, dataType=0, streamType=0.
            channel: 1,
            dataType: '0',
            streamType: '0',
          },
        });
        const advertised = String(record.params?.uploadUrl ?? uploadUrl);
        mdvrLog(
          `AB2 queued id=${record.id} status=${record.status} advertisedUploadUrl=${advertised}`,
        );
        // Don't block HLS attach — poll in the background so the console tells
        // the truth if the gateway is still HELD (device not AUTHENTICATED).
        void waitForAb2OnWire(record.id, () => cancelled).then((wire) => {
          if (cancelled) return;
          if (wire === 'QUEUED') {
            mdvrLog(
              `AB2 still not on the GPRS socket — MediaMTX will stay empty until device ${deviceId} (imei=${imei}) authenticates on device-gateway :5023/:6180.`,
            );
          } else if (wire === 'FAILED') {
            mdvrLog(`AB2 ${record.id} FAILED/EXPIRED — device will not push RTMP`);
          } else {
            mdvrLog(`AB2 ${wire} on the wire for device=${deviceId} — waiting for RTMP ingest`);
          }
        });
      })
        .then(() => {
          if (cancelled) return;
          mdvrLog(`AB2 accepted — attaching HLS player to ${url}`);
          setHlsUrl(url);
        })
        .catch((err) => {
          mdvrLog(`AB2 request FAILED for device=${deviceId} imei=${imei}:`, err);
          if (cancelled) return;
          teardown();
          setSession((prev) => (prev ? { ...prev, state: 'error' } : prev));
          setErrorState(true);
          scheduleReconnect();
        });

      return () => {
        cancelled = true;
        releaseMdvrLive(imei, stopMdvr);
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

  /** MDVR path: called by the HLS player when the playlist is ready / playback starts. */
  const onPlayerReady = useCallback(() => {
    mdvrLog(
      `player ready — imei=${channelRef.current?.imei ?? '?'} (HLS attached, clearing timeout)`,
    );
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

  return { session, stream, hlsUrl, mode, streamKind, setQuality, retry, onPlayerReady };
}

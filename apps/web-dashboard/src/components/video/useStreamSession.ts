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
  /**
   * MDVR path only: set when a DIFFERENT logical channel on this same
   * device already holds the device's one live RTMP stream (real MD300
   * hardware can push only one channel at a time). This tile is
   * deliberately not sending its own AB2 — it will retry once that
   * channel's tile closes.
   */
  blockedByChannel: number | null;
  /** Switch the simulcast layer (10 §2.3). */
  setQuality: (q: StreamQuality) => void;
  /** Manually retry the connection (after an error). */
  retry: () => void;
  /**
   * MDVR path: steal the device's one RTMP slot so THIS channel goes live
   * (the previous camera yields). No-op on the mock path.
   */
  switchToThis: () => void;
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

/**
 * Each camera publishes to its OWN RTMP/HLS key (`mdvrStreamKey`), so two
 * cameras on one MD300 can be live at the same time — they no longer fight
 * over a single MediaMTX path (which is what made every tile show camera 1).
 *
 * The lock below is therefore keyed per (IMEI, channel), i.e. per camera: it
 * only stops two tiles showing the SAME camera from firing duplicate AB2s
 * (they share one session via `refCount`), and serialises AB3-stop before a
 * re-open of that camera. Different cameras never contend.
 */
type MdvrDeviceLock = {
  channel: number;
  refCount: number;
  start: Promise<void>;
  /** Tiles waiting on this camera, notified once its lock frees. */
  waiters: Set<() => void>;
  /** Holder tile: bump retry so its effect tears down and releases. */
  yielders: Set<() => void>;
};
/** Lock identity: one live RTMP session per camera, not per device. */
function liveKey(imei: string, channel: number): string {
  return `${imei}#${channel}`;
}
const mdvrLocks = new Map<string, MdvrDeviceLock>();
/** In-flight AB3 so a reconnect cannot send AB2 before stop is queued. */
const mdvrStopping = new Map<string, Promise<void>>();
/** Operator-chosen camera for this key (cleared when it takes the lock). */
const mdvrPreferred = new Map<string, number>();
/** Waiters parked while the lock is empty but another camera is preferred. */
const mdvrPendingWaiters = new Map<string, Set<() => void>>();
/** Delayed AB3 after the live tile unmounts (React Strict Mode remounts in between). */
const mdvrDelayedStop = new Map<string, ReturnType<typeof setTimeout>>();

/** Register to be notified (once) the next time this camera's lock frees up. */
function waitForMdvrRelease(imei: string, channel: number, onFree: () => void): () => void {
  const key = liveKey(imei, channel);
  const lock = mdvrLocks.get(key);
  if (lock) {
    lock.waiters.add(onFree);
    return () => lock.waiters.delete(onFree);
  }
  if (mdvrPreferred.has(key)) {
    let pending = mdvrPendingWaiters.get(key);
    if (!pending) {
      pending = new Set();
      mdvrPendingWaiters.set(key, pending);
    }
    pending.add(onFree);
    return () => pending.delete(onFree);
  }
  onFree();
  return () => {};
}

/**
 * Try to become (or join) the live holder for THIS camera. Two tiles on the
 * same camera share one AB2 session; different cameras never block each other.
 */
function acquireMdvrLive(
  imei: string,
  channel: number,
  start: () => Promise<void>,
): { blocked: boolean; start: Promise<void> } {
  const key = liveKey(imei, channel);
  const existing = mdvrLocks.get(key);
  const preferred = mdvrPreferred.get(key);
  if (existing) {
    if (existing.channel === channel) {
      existing.refCount += 1;
      return { blocked: false, start: existing.start };
    }
    if (preferred === channel) {
      for (const yieldHolder of [...existing.yielders]) yieldHolder();
    }
    return { blocked: true, start: Promise.resolve() };
  }
  // Free lock: do not grab it if the operator asked for a different camera
  // (the preferred tile is about to mount / retry).
  if (preferred !== undefined && preferred !== channel) {
    return { blocked: true, start: Promise.resolve() };
  }
  const delayed = mdvrDelayedStop.get(key);
  if (delayed !== undefined) {
    clearTimeout(delayed);
    mdvrDelayedStop.delete(key);
  }
  const afterStop = mdvrStopping.get(key) ?? Promise.resolve();
  const lock: MdvrDeviceLock = {
    channel,
    refCount: 1,
    start: afterStop.catch(() => undefined).then(() => start()),
    waiters: new Set(),
    yielders: new Set(),
  };
  mdvrLocks.set(key, lock);
  const pending = mdvrPendingWaiters.get(key);
  if (pending) {
    mdvrPendingWaiters.delete(key);
    for (const notify of pending) notify();
  }
  lock.start.catch(() => {
    if (mdvrLocks.get(key) === lock) mdvrLocks.delete(key);
  });
  return { blocked: false, start: lock.start };
}

/**
 * Re-open this camera's live push (operator picked it again). Each camera has
 * its own RTMP key, so this never takes the stream away from another camera —
 * it just nudges this camera's tile to (re)send AB2 if it is not already live.
 */
export function stealMdvrLive(imei: string, channel: number): void {
  const key = liveKey(imei, channel);
  mdvrPreferred.set(key, channel);
  const existing = mdvrLocks.get(key);
  if (existing) {
    for (const yieldHolder of [...existing.yielders]) yieldHolder();
    return;
  }
  const pending = mdvrPendingWaiters.get(key);
  if (pending) {
    for (const notify of [...pending]) notify();
  }
}

/** Test helper — module-level locks survive between mounted walls. */
export function resetMdvrLiveForTests(): void {
  mdvrLocks.clear();
  mdvrStopping.clear();
  mdvrPreferred.clear();
  mdvrPendingWaiters.clear();
  for (const t of mdvrDelayedStop.values()) clearTimeout(t);
  mdvrDelayedStop.clear();
}

/** Release this camera's lock (no-op if this tile never held it). */
function releaseMdvrLive(imei: string, channel: number, stop: () => Promise<void>): void {
  const key = liveKey(imei, channel);
  const existing = mdvrLocks.get(key);
  if (!existing || existing.channel !== channel) return;
  existing.refCount -= 1;
  if (existing.refCount > 0) return;
  mdvrLocks.delete(key);
  const waiters = [...existing.waiters];

  // Delay AB3 so a React Strict Mode remount can re-acquire the same RTMP
  // session instead of stopping and restarting the camera for nothing.
  mdvrPreferred.delete(key);
  const delayed = setTimeout(() => {
    mdvrDelayedStop.delete(key);
    if (mdvrLocks.has(key)) return;
    mdvrLog(`AB3 after release channel=${channel} imei=${imei}`);
    const stopping = stop().catch(() => undefined);
    mdvrStopping.set(key, stopping);
    void stopping.finally(() => {
      if (mdvrStopping.get(key) === stopping) mdvrStopping.delete(key);
    });
  }, 50);
  mdvrDelayedStop.set(key, delayed);
  for (const notify of waiters) notify();
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
  const [blockedByChannel, setBlockedByChannel] = useState<number | null>(null);

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
    const logicalChannel = ch.logicalChannel ?? 1;
    mdvrLog(`AB3 stop → device=${ch.deviceId} imei=${ch.imei ?? '?'} channel=${logicalChannel}`);
    try {
      await apiPost(`/devices/${ch.deviceId}/commands`, {
        commandCode: 'AB3',
        params: { channel: logicalChannel, control: '0', closeType: '0', switchType: '0' },
      });
      mdvrLog(`AB3 accepted for device=${ch.deviceId} channel=${logicalChannel}`);
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
      setBlockedByChannel(null);
      return;
    }
    if (!channel.online || !channel.consentGiven) {
      teardown();
      setSession(null);
      setBlockedByChannel(null);
      return;
    }

    let cancelled = false;
    const initial = mockStreamSession(channel, currentQuality);
    setSession(initial);

    // ── MDVR real path ──────────────────────────────────────────────────────
    if (mdvr) {
      const imei = channel.imei ?? '';
      const deviceId = channel.deviceId ?? '';
      const logicalChannel = channel.logicalChannel ?? 1;
      const uploadUrl = mdvrRtmpUploadUrl(imei, logicalChannel);
      const url = mdvrHlsUrl(imei, logicalChannel);

      const startAb2 = async () => {
        mdvrLog(`POST /devices/${deviceId}/commands AB2`, {
          uploadUrl,
          channel: logicalChannel,
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
            channel: logicalChannel,
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
        if (cancelled) return;
        mdvrLog(`AB2 REST ${record.status} id=${record.id} — waiting for GPRS write`);
        setHlsUrl(url);
      };

      const lock = acquireMdvrLive(imei, logicalChannel, startAb2);

      if (lock.blocked) {
        const holder = mdvrLocks.get(liveKey(imei, logicalChannel))?.channel ?? null;
        mdvrLog(
          `channel=${logicalChannel} BLOCKED — device=${deviceId} imei=${imei} already has a live session for this camera; not sending a competing AB2 — will retry once that tile closes.`,
        );
        teardown();
        setBlockedByChannel(holder);
        const unsubscribe = waitForMdvrRelease(imei, logicalChannel, () => {
          if (cancelled) return;
          setRetryTrigger((n) => n + 1);
        });
        return () => {
          cancelled = true;
          unsubscribe();
        };
      }

      const yielders = mdvrLocks.get(liveKey(imei, logicalChannel))?.yielders;
      const onYield = () => {
        if (!cancelled) setRetryTrigger((n) => n + 1);
      };
      yielders?.add(onYield);

      setBlockedByChannel(null);
      mdvrLog(
        `opening channel=${channel.id} device=${deviceId} imei=${imei} cam=${logicalChannel} → AB2 uploadUrl=${uploadUrl} hlsUrl=${url}`,
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

      void lock.start.catch((err) => {
        mdvrLog(`AB2 request FAILED for device=${deviceId} imei=${imei}:`, err);
        if (cancelled) return;
        teardown();
        setSession((prev) => (prev ? { ...prev, state: 'error' } : prev));
        setErrorState(true);
        scheduleReconnect();
      });

      return () => {
        cancelled = true;
        yielders?.delete(onYield);
        releaseMdvrLive(imei, logicalChannel, stopMdvr);
        teardown();
      };
    }

    // ── Mock path ───────────────────────────────────────────────────────────
    setBlockedByChannel(null);
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

  /** Steal the device's one live RTMP slot so this camera becomes the publisher. */
  const switchToThis = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !isMdvrChannel(ch) || !ch.imei) {
      retry();
      return;
    }
    mdvrLog(
      `switch → imei=${ch.imei} channel=${ch.logicalChannel ?? 1} (steal the device's one RTMP slot)`,
    );
    stealMdvrLive(ch.imei, ch.logicalChannel ?? 1);
  }, [retry]);

  const streamKind: 'real' | 'stub' | 'unavailable' = errorState
    ? 'unavailable'
    : channel
      ? mdvr
        ? 'real'
        : 'stub'
      : 'unavailable';

  return {
    session,
    stream,
    hlsUrl,
    mode,
    streamKind,
    blockedByChannel,
    setQuality,
    retry,
    switchToThis,
    onPlayerReady,
  };
}

/**
 * useMdvrA9dPlayback — EXPERIMENTAL SD-card playback over A9D (Meitrack §3.24).
 *
 * Unlike AB4 (RTMP → MediaMTX → HLS), A9D makes the unit dial the platform's
 * media TCP port and send the recording in the same 0x12 packet format as A9A
 * live video. mdvr-streamer reassembles it into MPEG-TS and serves it on the
 * per-IMEI WebSocket room that JSMpeg reads (`/media-live/ws?imei=`).
 *
 * The streamer keys sessions by IMEI only, so A9D and A9A live video on the
 * same unit share one room — do not run both at once. A9E control=2 stops it.
 * Progress is read from the streamer's `/status/<imei>` (nginx
 * `/api/v1/media-live/…`), because JSMpeg's source-established callback fires
 * on WS open, not on the first frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiPost } from '@/api/client';
import { toMdvrBcdTime } from '@/api/video.api';
import { isMdvrChannel } from '@/components/video/useStreamSession';
import type { DeviceCommandRecord } from '@/types/command.types';
import type { CameraChannel } from '@/types/video.types';

const STATUS_POLL_MS = 2_000;
const DEFAULT_MEDIA_TCP_PORT = 6182;

export type A9dStatus = 'idle' | 'starting' | 'waiting' | 'streaming' | 'error';

/** Subset of mdvr-streamer `StreamStats` the test player shows. */
export interface A9dStreamStats {
  codec: 'h264' | 'hevc' | null;
  connected: boolean;
  producing: boolean;
  packets: number;
  bytesIn: number;
  lastPacketAt: number | null;
}

function a9dLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[MDVR:A9D]', ...args);
}

/** Same-origin JSMpeg WebSocket for one unit (nginx `/media-live/ws` → streamer). */
export function mdvrStreamerWsUrl(imei: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/media-live/ws?imei=${encodeURIComponent(imei)}`;
}

async function fetchStreamStats(imei: string): Promise<A9dStreamStats | null> {
  const res = await fetch(`/api/v1/media-live/status/${encodeURIComponent(imei)}`);
  if (!res.ok) return null;
  return (await res.json()) as A9dStreamStats;
}

export function useMdvrA9dPlayback() {
  const [status, setStatus] = useState<A9dStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<A9dStreamStats | null>(null);
  const channelRef = useRef<CameraChannel | null>(null);
  const pollRef = useRef<number | null>(null);
  const genRef = useRef(0);

  const clearPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const sendStop = useCallback(async (ch: CameraChannel | null) => {
    if (!ch?.deviceId) return;
    const channel = ch.logicalChannel ?? 1;
    a9dLog(`A9E stop → device=${ch.deviceId} channel=${channel}`);
    try {
      await apiPost(`/devices/${ch.deviceId}/commands`, {
        commandCode: 'A9E',
        params: { channel, control: '2' },
      });
    } catch (err) {
      a9dLog('A9E stop failed (best-effort):', err);
    }
  }, []);

  const stop = useCallback(async () => {
    genRef.current += 1;
    clearPoll();
    const ch = channelRef.current;
    channelRef.current = null;
    setWsUrl(null);
    setStats(null);
    setError(null);
    setStatus('idle');
    await sendStop(ch);
  }, [clearPoll, sendStop]);

  const start = useCallback(
    async (ch: CameraChannel, fromMs: number, toMs: number) => {
      const gen = ++genRef.current;
      clearPoll();
      setStats(null);
      setError(null);
      setWsUrl(null);
      if (!isMdvrChannel(ch) || !ch.deviceId || !ch.imei) {
        setStatus('error');
        setError('not-mdvr');
        return;
      }
      const imei = ch.imei;
      channelRef.current = ch;
      setStatus('starting');

      const channel = ch.logicalChannel ?? 1;
      // Loopback is rewritten to MDVR_PUBLIC_HOST by fleet-management.
      const server = import.meta.env.VITE_MDVR_PUBLIC_HOST || window.location.hostname;
      const tcpPort = Number(import.meta.env.VITE_MDVR_VIDEO_PORT ?? DEFAULT_MEDIA_TCP_PORT);
      const startTime = toMdvrBcdTime(fromMs);
      const endTime = toMdvrBcdTime(toMs);
      a9dLog(
        `A9D start device=${ch.deviceId} imei=${imei} cam=${channel} ${startTime}–${endTime} → ${server}:${tcpPort}`,
      );
      try {
        const queued = await apiPost<Record<string, unknown>, DeviceCommandRecord>(
          `/devices/${ch.deviceId}/commands`,
          {
            commandCode: 'A9D',
            params: {
              server,
              tcpPort,
              udpPort: 0,
              channel,
              avType: '3',
              streamType: '0',
              capType: '0',
              reviewStyle: '0',
              startTime,
              endTime,
            },
          },
        );
        a9dLog(`A9D queued id=${queued.id} status=${queued.status}`);
      } catch (err) {
        if (gen !== genRef.current) return;
        a9dLog('A9D failed:', err);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'A9D failed');
        return;
      }
      if (gen !== genRef.current) return;

      // Join the room now: the streamer only broadcasts, so a late viewer
      // misses nothing it could replay anyway.
      setWsUrl(mdvrStreamerWsUrl(imei));
      setStatus('waiting');
      pollRef.current = window.setInterval(() => {
        void fetchStreamStats(imei)
          .then((s) => {
            if (gen !== genRef.current) return;
            setStats(s);
            if (s?.producing) setStatus('streaming');
          })
          .catch(() => undefined);
      }, STATUS_POLL_MS);
    },
    [clearPoll],
  );

  useEffect(
    () => () => {
      genRef.current += 1;
      clearPoll();
      void sendStop(channelRef.current);
    },
    [clearPoll, sendStop],
  );

  return { status, error, wsUrl, stats, start, stop };
}

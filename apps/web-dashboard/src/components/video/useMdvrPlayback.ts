/**
 * useMdvrPlayback — AB4 RTMP playback from the MDVR SD card (Meitrack §3.x).
 *
 * Load sends AB4 (startTime/endTime + RTMP URL). The device pushes recorded
 * video to MediaMTX on the live key (`live/md300/{n}` — `/pb` is dropped).
 * Seek is AB5 drag; teardown is AB5 end. Non-MDVR channels never hit this hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiPost } from '@/api/client';
import {
  mdvrPlaybackHlsUrl,
  mdvrPlaybackRtmpUrl,
  mdvrRtmpUploadUrl,
  toMdvrBcdTime,
} from '@/api/video.api';
import { isMdvrChannel } from '@/components/video/useStreamSession';
import type { CameraChannel } from '@/types/video.types';

const PLAYBACK_TIMEOUT_MS = 120_000;

export type MdvrPlaybackStatus = 'idle' | 'starting' | 'waiting' | 'ready' | 'error';

function mdvrLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[MDVR:PB]', ...args);
}

export function useMdvrPlayback() {
  const [channel, setChannel] = useState<CameraChannel | null>(null);
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<MdvrPlaybackStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);
  const channelRef = useRef<CameraChannel | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<MdvrPlaybackStatus>('idle');
  channelRef.current = channel;
  statusRef.current = status;

  const clearWaitTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const endDevice = useCallback(async (ch: CameraChannel | null) => {
    if (!ch?.deviceId || !isMdvrChannel(ch)) return;
    const logicalChannel = ch.logicalChannel ?? 1;
    mdvrLog(`AB5 end → device=${ch.deviceId} channel=${logicalChannel}`);
    try {
      await apiPost(`/devices/${ch.deviceId}/commands`, {
        commandCode: 'AB5',
        params: { channel: logicalChannel, control: '2' },
      });
    } catch (err) {
      mdvrLog('AB5 end failed (best-effort):', err);
    }
  }, []);

  const startLive = useCallback(async (ch: CameraChannel) => {
    if (!ch.deviceId || !ch.imei) return;
    const logicalChannel = ch.logicalChannel ?? 1;
    const uploadUrl = mdvrRtmpUploadUrl(ch.imei, logicalChannel);
    mdvrLog(`AB2 prime live → device=${ch.deviceId} channel=${logicalChannel} url=${uploadUrl}`);
    try {
      await apiPost(`/devices/${ch.deviceId}/commands`, {
        commandCode: 'AB2',
        params: {
          uploadUrl,
          channel: logicalChannel,
          dataType: '0',
          streamType: '0',
        },
      });
    } catch (err) {
      mdvrLog('AB2 prime live failed (best-effort):', err);
    }
  }, []);

  const stop = useCallback(async () => {
    genRef.current += 1;
    clearWaitTimer();
    const ch = channelRef.current;
    setHlsUrl(null);
    setChannel(null);
    setStatus('idle');
    setError(null);
    await endDevice(ch);
  }, [endDevice, clearWaitTimer]);

  const start = useCallback(
    async (ch: CameraChannel, fromMs: number, toMs: number, avType = '3') => {
      const gen = ++genRef.current;
      clearWaitTimer();
      setChannel(ch);
      setError(null);
      setHlsUrl(null);
      setStatus(isMdvrChannel(ch) && ch.deviceId && ch.imei ? 'starting' : 'idle');

      if (!isMdvrChannel(ch) || !ch.deviceId || !ch.imei) {
        setStatus('idle');
        return;
      }

      // MD300 playback reuses the live RTMP socket. Stopping live first leaves
      // AB4 connecting then idle-timing-out without a publisher.
      await startLive(ch);
      await new Promise((r) => setTimeout(r, 2500));
      if (gen !== genRef.current) return;

      const logicalChannel = ch.logicalChannel ?? 1;
      const url = mdvrPlaybackRtmpUrl(ch.imei, logicalChannel);
      setStatus('starting');
      mdvrLog(
        `AB4 start device=${ch.deviceId} cam=${logicalChannel} ${toMdvrBcdTime(fromMs)}–${toMdvrBcdTime(toMs)} url=${url}`,
      );
      try {
        await apiPost(`/devices/${ch.deviceId}/commands`, {
          commandCode: 'AB4',
          params: {
            url,
            channel: logicalChannel,
            avType,
            streamType: '0',
            capType: '0',
            startTime: toMdvrBcdTime(fromMs),
            endTime: toMdvrBcdTime(toMs),
          },
        });
      } catch (err) {
        if (gen !== genRef.current) return;
        mdvrLog('AB4 failed:', err);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'AB4 failed');
        return;
      }
      if (gen !== genRef.current) return;
      setHlsUrl(mdvrPlaybackHlsUrl(ch.imei, logicalChannel));
      setStatus('waiting');
      timeoutRef.current = setTimeout(() => {
        if (gen !== genRef.current) return;
        if (statusRef.current !== 'waiting' && statusRef.current !== 'starting') return;
        setStatus('error');
        setError('timeout');
      }, PLAYBACK_TIMEOUT_MS);
    },
    [startLive, clearWaitTimer],
  );

  const seekDevice = useCallback(async (ms: number) => {
    const ch = channelRef.current;
    if (!ch?.deviceId || !isMdvrChannel(ch)) return;
    const dragPoint = toMdvrBcdTime(ms);
    mdvrLog(`AB5 drag → device=${ch.deviceId} ${dragPoint}`);
    try {
      await apiPost(`/devices/${ch.deviceId}/commands`, {
        commandCode: 'AB5',
        params: {
          channel: ch.logicalChannel ?? 1,
          control: '5',
          dragPoint,
        },
      });
    } catch (err) {
      mdvrLog('AB5 drag failed (best-effort):', err);
    }
  }, []);

  const onPlayerReady = useCallback(() => {
    clearWaitTimer();
    setStatus('ready');
    setError(null);
  }, [clearWaitTimer]);

  useEffect(
    () => () => {
      genRef.current += 1;
      clearWaitTimer();
      void endDevice(channelRef.current);
    },
    [endDevice, clearWaitTimer],
  );

  return {
    channel,
    hlsUrl,
    status,
    error,
    start,
    stop,
    seekDevice,
    onPlayerReady,
  };
}

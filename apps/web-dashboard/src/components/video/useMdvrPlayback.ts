/**
 * useMdvrPlayback — AB4 RTMP playback from the MDVR SD card (Meitrack §3.x).
 *
 * AB4 publishes the SD-card clip to its OWN key, `<camera key>/pb` — verified
 * on a live MD300, where `live/md300/pb` carried the recording (frame stamped
 * with the clip's own date) while `live/md300` carried the live camera. The
 * player therefore watches `/pb` (`mdvrPlaybackHlsUrl`); watching the live key
 * showed the live camera while the recording streamed on unread.
 *
 * AB2 still primes the RTMP socket first, then AB4 retargets, with a settle
 * delay before HLS attaches. Seek is AB5 drag; teardown is AB5 end. Non-MDVR
 * channels never hit this hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiPost } from '@/api/client';
import {
  mdvrPlaybackHlsUrl,
  mdvrPlaybackRtmpUrl,
  mdvrRtmpUploadUrl,
  toMdvrBcdTime,
} from '@/api/video.api';
import { waitForMdvrCommand } from '@/components/video/useMdvrResources';
import { isMdvrChannel } from '@/components/video/useStreamSession';
import type { DeviceCommandRecord } from '@/types/command.types';
import type { CameraChannel } from '@/types/video.types';

const PLAYBACK_TIMEOUT_MS = 120_000;
/**
 * How long to wait for the clip's RTMP push to reach MediaMTX after AB4 is
 * ACKed. The unit ACKs immediately but can take ~2 minutes to actually start
 * publishing (measured: AB4 ACK 22:39:15 → publisher on `<key>/pb` 22:41:06),
 * and the MediaMTX transcode adds a few seconds on top. A 120s budget expired
 * just before the stream arrived and surfaced a false "timeout".
 */
const STREAM_ARRIVAL_TIMEOUT_MS = 240_000;
const AB2_ACK_MS = 25_000;
/** After live RTMP is up, wait before AB4 so the socket is actually publishing. */
const AB2_SETTLE_MS = 1_500;
/** After AB4 ACK, wait before HLS so MediaMTX is no longer the live camera. */
const AB4_SWITCH_MS = 2_000;

export type MdvrPlaybackStatus = 'idle' | 'starting' | 'waiting' | 'ready' | 'error';

function mdvrLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[MDVR:PB]', ...args);
}

export function useMdvrPlayback() {
  const [channel, setChannel] = useState<CameraChannel | null>(null);
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [playerKey, setPlayerKey] = useState(0);
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

  const startLive = useCallback(async (ch: CameraChannel, isCancelled: () => boolean) => {
    if (!ch.deviceId || !ch.imei) return;
    const logicalChannel = ch.logicalChannel ?? 1;
    const uploadUrl = mdvrRtmpUploadUrl(ch.imei, logicalChannel);
    mdvrLog(`AB2 prime live → device=${ch.deviceId} channel=${logicalChannel} url=${uploadUrl}`);
    try {
      const queued = await apiPost<Record<string, unknown>, DeviceCommandRecord>(
        `/devices/${ch.deviceId}/commands`,
        {
          commandCode: 'AB2',
          params: {
            uploadUrl,
            channel: logicalChannel,
            dataType: '0',
            streamType: '0',
          },
        },
      );
      try {
        await waitForMdvrCommand(queued.id, AB2_ACK_MS, isCancelled);
      } catch (err) {
        mdvrLog('AB2 prime wait (best-effort):', err);
      }
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
    async (ch: CameraChannel, fromMs: number, toMs: number, avType = '0') => {
      const gen = ++genRef.current;
      clearWaitTimer();
      setChannel(ch);
      setError(null);
      setHlsUrl(null);
      setStatus(isMdvrChannel(ch) && ch.deviceId && ch.imei ? 'starting' : 'idle');

      if (!isMdvrChannel(ch) || !ch.deviceId || !ch.imei) {
        setStatus('idle');
        return false;
      }

      const cancelled = () => gen !== genRef.current;

      // Prime the RTMP socket with AB2, but do not attach HLS yet — that playlist
      // is still the live camera until AB4 retargets the encoder.
      await startLive(ch, cancelled);
      await new Promise((r) => setTimeout(r, AB2_SETTLE_MS));
      if (cancelled()) return false;

      const logicalChannel = ch.logicalChannel ?? 1;
      const url = mdvrPlaybackRtmpUrl(ch.imei, logicalChannel);
      setStatus('starting');
      mdvrLog(
        `AB4 start device=${ch.deviceId} cam=${logicalChannel} ${toMdvrBcdTime(fromMs)}–${toMdvrBcdTime(toMs)} url=${url}`,
      );
      try {
        const queued = await apiPost<Record<string, unknown>, DeviceCommandRecord>(
          `/devices/${ch.deviceId}/commands`,
          {
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
          },
        );
        const done = await waitForMdvrCommand(queued.id, PLAYBACK_TIMEOUT_MS, cancelled);
        if (done.status !== 'ACKED') {
          throw new Error(done.error ?? done.responseText ?? `AB4 ${done.status}`);
        }
      } catch (err) {
        if (cancelled()) return false;
        mdvrLog('AB4 failed:', err);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'AB4 failed');
        return false;
      }
      await new Promise((r) => setTimeout(r, AB4_SWITCH_MS));
      if (cancelled()) return false;
      // Bust cached live segments and remount so hls.js does not keep the live edge.
      setPlayerKey((k) => k + 1);
      setHlsUrl(`${mdvrPlaybackHlsUrl(ch.imei, logicalChannel)}?pb=${Date.now()}`);
      setStatus('waiting');
      timeoutRef.current = setTimeout(() => {
        if (cancelled()) return;
        if (statusRef.current !== 'waiting' && statusRef.current !== 'starting') return;
        setStatus('error');
        setError('timeout');
      }, STREAM_ARRIVAL_TIMEOUT_MS);
      return true;
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
    playerKey,
    status,
    error,
    start,
    stop,
    seekDevice,
    onPlayerReady,
  };
}

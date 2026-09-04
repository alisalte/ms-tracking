/**
 * useMdvrResources — AB8 SD-card catalog (Meitrack §3.31).
 *
 * Search sends two AB8 queries sequentially (video then photos). Concurrent
 * AB8s would collide on `latestPendingByCode`. Clicking a row is AB4 in
 * `useMdvrPlayback` — this hook only lists what the device reported.
 */
import { useCallback, useRef, useState } from 'react';

import { apiPost } from '@/api/client';
import { fetchDeviceCommand } from '@/api/command.api';
import {
  type MdvrResource,
  mdvrResourceKind,
  parseMdvrResourceAck,
  toMdvrBcdTime,
} from '@/api/video.api';
import { isMdvrChannel } from '@/components/video/useStreamSession';
import type { DeviceCommandRecord } from '@/types/command.types';
import type { CameraChannel } from '@/types/video.types';

const AB8_POLL_MS = 1_500;
const AB8_TIMEOUT_MS = 45_000;

export type MdvrResourceStatus = 'idle' | 'listing' | 'ready' | 'error';

function mdvrLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[MDVR:AB8]', ...args);
}

function isNoFileError(rec: DeviceCommandRecord): boolean {
  return /FFF5/i.test(`${rec.error ?? ''} ${rec.responseText ?? ''}`);
}

async function waitForAb8(
  commandId: string,
  isCancelled: () => boolean,
): Promise<DeviceCommandRecord> {
  const deadline = Date.now() + AB8_TIMEOUT_MS;
  let last: DeviceCommandRecord | null = null;
  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error('cancelled');
    last = await fetchDeviceCommand(commandId);
    if (last.status === 'ACKED' || last.status === 'FAILED' || last.status === 'EXPIRED') {
      return last;
    }
    await new Promise((r) => setTimeout(r, AB8_POLL_MS));
  }
  throw new Error(last ? `AB8 still ${last.status}` : 'AB8 timeout');
}

async function queryAb8(
  ch: CameraChannel,
  fromMs: number,
  toMs: number,
  avType: '3' | '4',
  isCancelled: () => boolean,
): Promise<MdvrResource[]> {
  const logicalChannel = ch.logicalChannel ?? 1;
  mdvrLog(
    `AB8 avType=${avType} cam=${logicalChannel} ${toMdvrBcdTime(fromMs)}–${toMdvrBcdTime(toMs)}`,
  );
  const queued = await apiPost<Record<string, unknown>, DeviceCommandRecord>(
    `/devices/${ch.deviceId}/commands`,
    {
      commandCode: 'AB8',
      params: {
        channel: logicalChannel,
        startTime: toMdvrBcdTime(fromMs),
        endTime: toMdvrBcdTime(toMs),
        avType,
        streamType: '0',
        capType: '0',
      },
    },
  );
  const done = await waitForAb8(queued.id, isCancelled);
  if (done.status !== 'ACKED') {
    if (isNoFileError(done)) {
      mdvrLog(`AB8 avType=${avType} empty (FFF5)`);
      return [];
    }
    throw new Error(done.error ?? done.responseText ?? `AB8 ${done.status}`);
  }
  return parseMdvrResourceAck(done.responseText);
}

export function useMdvrResources() {
  const [status, setStatus] = useState<MdvrResourceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<MdvrResource[]>([]);
  const [photos, setPhotos] = useState<MdvrResource[]>([]);
  const genRef = useRef(0);

  const reset = useCallback(() => {
    genRef.current += 1;
    setStatus('idle');
    setError(null);
    setVideos([]);
    setPhotos([]);
  }, []);

  const search = useCallback(async (ch: CameraChannel, fromMs: number, toMs: number) => {
    const gen = ++genRef.current;
    const cancelled = () => gen !== genRef.current;
    setError(null);
    setVideos([]);
    setPhotos([]);

    if (!isMdvrChannel(ch) || !ch.deviceId) {
      setStatus('idle');
      return;
    }

    setStatus('listing');
    const collected: MdvrResource[] = [];
    const errors: string[] = [];

    for (const avType of ['3', '4'] as const) {
      if (cancelled()) return;
      try {
        collected.push(...(await queryAb8(ch, fromMs, toMs, avType, cancelled)));
      } catch (err) {
        if (cancelled() || (err instanceof Error && err.message === 'cancelled')) return;
        const message = err instanceof Error ? err.message : 'AB8 failed';
        mdvrLog(`AB8 avType=${avType} failed:`, message);
        errors.push(message);
      }
    }
    if (cancelled()) return;

    const nextVideos = collected.filter((r) => mdvrResourceKind(r.avType) === 'video');
    const nextPhotos = collected.filter((r) => mdvrResourceKind(r.avType) === 'photo');
    setVideos(nextVideos);
    setPhotos(nextPhotos);
    if (nextVideos.length === 0 && nextPhotos.length === 0 && errors.length > 0) {
      setStatus('error');
      setError(errors[0] ?? 'AB8 failed');
      return;
    }
    setStatus('ready');
    setError(errors[0] ?? null);
  }, []);

  return { status, error, videos, photos, search, reset };
}

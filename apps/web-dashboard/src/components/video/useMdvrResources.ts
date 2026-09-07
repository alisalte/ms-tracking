/**
 * useMdvrResources — AB8 SD-card catalog (Meitrack §3.31) plus D01 photo names.
 *
 * Search sends two AB8 queries sequentially (video then photos), then D01 so
 * JPEG rows have filenames for D00 download. Concurrent AB8s would collide on
 * `latestPendingByCode`. Video rows play via AB4 in `useMdvrPlayback`; photo
 * rows download via D00.
 */
import { useCallback, useRef, useState } from 'react';

import { apiPost } from '@/api/client';
import { fetchDeviceCommand } from '@/api/command.api';
import {
  type MdvrResource,
  fromMdvrBcdTime,
  mdvrResourceKind,
  parseMdvrPhotoAck,
  parseMdvrPhotoListAck,
  parseMdvrResourceAck,
  toMdvrBcdTime,
} from '@/api/video.api';
import { isMdvrChannel } from '@/components/video/useStreamSession';
import { parseMdvrEventPhotoName } from '@/lib/alarm-evidence';
import type { DeviceCommandRecord } from '@/types/command.types';
import type { CameraChannel } from '@/types/video.types';

const AB8_POLL_MS = 1_500;
const AB8_TIMEOUT_MS = 120_000;
const D00_TIMEOUT_MS = 90_000;
/** D03 capture: the unit answers once the JPEG is written, which can take a while. */
const D03_TIMEOUT_MS = 90_000;
/** Let the unit close the file before D00 asks for it. */
const CAPTURE_SETTLE_MS = 2_000;
const PHOTO_NAME_SLOP_MS = 2_000;
const LIST_TTL_SEC = 180;

export type MdvrResourceStatus = 'idle' | 'listing' | 'ready' | 'error';

function mdvrLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[MDVR:AB8]', ...args);
}

function isNoFileError(rec: DeviceCommandRecord): boolean {
  return /FFF5/i.test(`${rec.error ?? ''} ${rec.responseText ?? ''}`);
}

function listFailureMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'AB8 failed';
  if (/TTL_EXPIRED|command still QUEUED|command still SENT|command timeout/i.test(message)) {
    return 'device-no-reply';
  }
  return message;
}

export async function waitForMdvrCommand(
  commandId: string,
  timeoutMs: number,
  isCancelled: () => boolean,
): Promise<DeviceCommandRecord> {
  const deadline = Date.now() + timeoutMs;
  let last: DeviceCommandRecord | null = null;
  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error('cancelled');
    last = await fetchDeviceCommand(commandId);
    if (last.status === 'ACKED' || last.status === 'FAILED' || last.status === 'EXPIRED') {
      return last;
    }
    await new Promise((r) => setTimeout(r, AB8_POLL_MS));
  }
  throw new Error(last ? `command still ${last.status}` : 'command timeout');
}

async function waitForAb8(
  commandId: string,
  isCancelled: () => boolean,
): Promise<DeviceCommandRecord> {
  return waitForMdvrCommand(commandId, AB8_TIMEOUT_MS, isCancelled);
}

async function queryAb8(
  ch: CameraChannel,
  fromMs: number,
  toMs: number,
  avType: string,
  isCancelled: () => boolean,
  channel = 0,
): Promise<MdvrResource[]> {
  mdvrLog(`AB8 avType=${avType} cam=${channel} ${toMdvrBcdTime(fromMs)}–${toMdvrBcdTime(toMs)}`);
  const queued = await apiPost<Record<string, unknown>, DeviceCommandRecord>(
    `/devices/${ch.deviceId}/commands`,
    {
      commandCode: 'AB8',
      ttlSec: LIST_TTL_SEC,
      params: {
        channel,
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

async function queryD01Page(
  deviceId: string,
  startIndex: number,
  isCancelled: () => boolean,
): Promise<string[]> {
  if (!deviceId) return [];
  mdvrLog(`D01 list photos device=${deviceId} startIndex=${startIndex}`);
  const queued = await apiPost<Record<string, unknown>, DeviceCommandRecord>(
    `/devices/${deviceId}/commands`,
    { commandCode: 'D01', ttlSec: LIST_TTL_SEC, params: { startIndex } },
  );
  const done = await waitForMdvrCommand(queued.id, AB8_TIMEOUT_MS, isCancelled);
  if (done.status !== 'ACKED') {
    if (isNoFileError(done)) return [];
    throw new Error(done.error ?? done.responseText ?? `D01 ${done.status}`);
  }
  return parseMdvrPhotoListAck(done.responseText);
}

async function queryD01(deviceId: string, isCancelled: () => boolean): Promise<string[]> {
  const all: string[] = [];
  const seen = new Set<string>();
  let startIndex = 0;
  for (let page = 0; page < 20; page++) {
    if (isCancelled()) return all;
    const names = await queryD01Page(deviceId, startIndex, isCancelled);
    let added = 0;
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      all.push(name);
      added += 1;
    }
    if (names.length === 0 || added === 0) break;
    startIndex += names.length;
  }
  return all;
}

/**
 * Attach D01 JPEG filenames to AB8 photo rows (matched by BCD time / channel),
 * and add leftover D01 names that fall inside the search window.
 */
export function mergeMdvrPhotoFilenames(
  photos: MdvrResource[],
  names: string[],
  opts: { logicalChannel: number; fromMs: number; toMs: number },
): MdvrResource[] {
  const unused = names.map((n) => n.trim()).filter(Boolean);
  const merged = photos.map((p) => {
    if (p.filename) return p;
    const startMs = fromMdvrBcdTime(p.startTime);
    const idx = unused.findIndex((name) => {
      const parsed = parseMdvrEventPhotoName(name);
      if (!parsed) return false;
      if (parsed.channel > 0 && p.channel > 0 && parsed.channel !== p.channel) return false;
      if (parsed.bcdTime && parsed.bcdTime === p.startTime) return true;
      if (Number.isFinite(parsed.capturedAtMs) && Number.isFinite(startMs)) {
        return Math.abs(parsed.capturedAtMs - startMs) <= PHOTO_NAME_SLOP_MS;
      }
      return false;
    });
    if (idx < 0) return p;
    const filename = unused.splice(idx, 1)[0];
    return filename ? { ...p, filename } : p;
  });

  for (const name of unused) {
    const parsed = parseMdvrEventPhotoName(name);
    if (parsed && parsed.channel > 0 && parsed.channel !== opts.logicalChannel) continue;
    merged.push({
      channel: parsed?.channel || opts.logicalChannel,
      startTime: parsed?.bcdTime || '000000000000',
      endTime: parsed?.bcdTime || '000000000000',
      avType: 4,
      streamType: 0,
      capType: 0,
      fileLen: 0,
      eventCode: parsed?.eventCode ?? 0,
      subEventCode: parsed?.subEventCode ?? 0,
      filename: parsed?.filename || name,
    });
  }
  return merged.sort((a, b) => a.startTime.localeCompare(b.startTime));
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
    const logicalChannel = ch.logicalChannel ?? 1;

    try {
      const rows = await queryAb8(ch, fromMs, toMs, '0', cancelled, 0);
      collected.push(...rows.filter((r) => r.channel === 0 || r.channel === logicalChannel));
    } catch (err) {
      if (cancelled() || (err instanceof Error && err.message === 'cancelled')) return;
      const message = listFailureMessage(err);
      mdvrLog('AB8 failed:', message);
      errors.push(message);
    }
    if (cancelled()) return;

    let photoNames: string[] = [];
    try {
      photoNames = await queryD01(ch.deviceId, cancelled);
    } catch (err) {
      if (cancelled() || (err instanceof Error && err.message === 'cancelled')) return;
      const message = listFailureMessage(err);
      mdvrLog('D01 failed:', message);
      errors.push(message);
    }
    if (cancelled()) return;

    const nextVideos = collected.filter((r) => mdvrResourceKind(r.avType) === 'video');
    const nextPhotos = mergeMdvrPhotoFilenames(
      collected.filter((r) => mdvrResourceKind(r.avType) === 'photo'),
      photoNames,
      { logicalChannel: ch.logicalChannel ?? 1, fromMs, toMs },
    );
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

/** One SD-card file plus the camera it was listed on (alarm-drawer playback). */
export interface AlarmMdvrClip {
  resource: MdvrResource;
  channel: CameraChannel;
}

/**
 * Sequential AB8 across cameras (concurrent AB8 on one MDVR collides).
 * Photos are listed when the operator asks for the alarm window (and always
 * for DMS event evidence).
 */
export async function listMdvrEvidence(
  channels: CameraChannel[],
  fromMs: number,
  toMs: number,
  includePhotos: boolean,
  isCancelled: () => boolean,
): Promise<{ videos: AlarmMdvrClip[]; photos: AlarmMdvrClip[]; error: string | null }> {
  const videos: AlarmMdvrClip[] = [];
  const photos: AlarmMdvrClip[] = [];
  const errors: string[] = [];

  for (const ch of channels) {
    if (isCancelled()) break;
    if (!isMdvrChannel(ch)) continue;
    try {
      for (const resource of await queryAb8(
        ch,
        fromMs,
        toMs,
        '0',
        isCancelled,
        ch.logicalChannel ?? 1,
      )) {
        if (mdvrResourceKind(resource.avType) === 'photo') {
          if (includePhotos) photos.push({ resource, channel: ch });
        } else {
          videos.push({ resource, channel: ch });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') break;
      errors.push(listFailureMessage(err));
    }
  }

  const empty = videos.length === 0 && photos.length === 0;
  return { videos, photos, error: empty ? (errors[0] ?? null) : null };
}

/** D00 named-file download — used for DMS event snapshots (`photoName`). */
export async function fetchMdvrPhoto(
  deviceId: string,
  filename: string,
  isCancelled: () => boolean,
): Promise<{ blob: Blob; filename: string }> {
  mdvrLog(`D00 filename=${filename}`);
  const queued = await apiPost<Record<string, unknown>, DeviceCommandRecord>(
    `/devices/${deviceId}/commands`,
    { commandCode: 'D00', params: { filename, startPacket: 0 } },
  );
  const done = await waitForMdvrCommand(queued.id, D00_TIMEOUT_MS, isCancelled);
  if (done.status !== 'ACKED') {
    throw new Error(done.error ?? done.responseText ?? `D00 ${done.status}`);
  }
  const parsed = parseMdvrPhotoAck(done.responseText);
  if (!parsed) throw new Error('D00 returned no image');
  return {
    filename: parsed.filename || filename,
    blob: new Blob([new Uint8Array(parsed.bytes)], { type: 'image/jpeg' }),
  };
}

/** Name we ask the unit to store an on-demand capture under (D03 `imagename`). */
export function mdvrCaptureFilename(camera: number, at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `snap${stamp}_ch${camera}.jpg`;
}

/**
 * On-demand snapshot from one camera: **D03 → D00**.
 *
 * D03 triggers the capture and the unit answers `D03,OK` once the JPEG is on
 * the SD card (catalog: "the file appears in the D01 listing"). Because we
 * choose `imagename` ourselves the download normally needs no D01 round-trip;
 * if the unit stored it under a different name we fall back to the listing.
 *
 * Unlike live video this rides the plain command channel, so it works even
 * when the unit cannot be reached for an RTMP dialback (CGNAT).
 */
export async function captureMdvrPhoto(
  deviceId: string,
  camera: number,
  isCancelled: () => boolean,
): Promise<{ blob: Blob; filename: string }> {
  const filename = mdvrCaptureFilename(camera);
  mdvrLog(`D03 capture device=${deviceId} camera=${camera} imagename=${filename}`);
  const queued = await apiPost<Record<string, unknown>, DeviceCommandRecord>(
    `/devices/${deviceId}/commands`,
    { commandCode: 'D03', params: { camera, imagename: filename } },
  );
  const done = await waitForMdvrCommand(queued.id, D03_TIMEOUT_MS, isCancelled);
  if (done.status !== 'ACKED') {
    throw new Error(done.error ?? done.responseText ?? `D03 ${done.status}`);
  }
  // The ACK can land before the file is closed on the card.
  await new Promise((r) => setTimeout(r, CAPTURE_SETTLE_MS));
  if (isCancelled()) throw new Error('cancelled');
  try {
    return await fetchMdvrPhoto(deviceId, filename, isCancelled);
  } catch (err) {
    if (isCancelled()) throw err;
    mdvrLog(`D00 for ${filename} failed — checking the D01 listing:`, err);
    const names = await queryD01(deviceId, isCancelled);
    const match = names.find((name) => name.trim().toLowerCase() === filename.toLowerCase());
    if (!match) throw err;
    return fetchMdvrPhoto(deviceId, match, isCancelled);
  }
}

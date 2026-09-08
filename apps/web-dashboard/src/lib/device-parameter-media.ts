/**
 * Device Parameter → Media (Phase 3).
 *
 * Composite form for speaker volume (BB8) + FTP photo upload (B64).
 * Event-linked CH recording stays under Alarm (CB8). Live/playback cmds
 * remain in the Command Center catalog.
 */

import {
  type ParameterSnapshot,
  type ParameterSnapshotSource,
  loadParameterSnapshot,
  parameterCacheKey,
  saveParameterSnapshot,
  stampParameterSnapshot,
} from '@/lib/device-parameter-state';
import { type CommandHistoryLike, lastStoredSettings } from '@/lib/meitrack-readback';

export type FtpPhotoMode = '0' | '1' | '2';

export interface MediaParameterSett {
  /** BB8 0–100 */
  speakerVolume: number;
  /** B64 mode: 0 off, 1 upload, 2 clear params */
  ftpMode: FtpPhotoMode;
  ftpUsername: string;
  ftpPassword: string;
  ftpHost: string;
  ftpPort: string;
  ftpPath: string;
}

export type MediaSnapshotSource = ParameterSnapshotSource;
export type MediaParameterSnapshot = ParameterSnapshot<MediaParameterSett>;

export interface ComposedMediaCommand {
  commandCode: string;
  params: Record<string, string | number>;
  label: string;
}

export function defaultMediaSett(): MediaParameterSett {
  return {
    speakerVolume: 10,
    ftpMode: '0',
    ftpUsername: '',
    ftpPassword: '',
    ftpHost: '',
    ftpPort: '21',
    ftpPath: '',
  };
}

export function composeMediaCommands(sett: MediaParameterSett): ComposedMediaCommand[] {
  const out: ComposedMediaCommand[] = [
    {
      commandCode: 'BB8',
      params: { volume: Math.max(0, Math.min(100, Math.round(sett.speakerVolume))) },
      label: 'BB8 speaker volume',
    },
  ];

  if (sett.ftpMode === '2') {
    out.push({
      commandCode: 'B64',
      params: { mode: '2' },
      label: 'B64 clear FTP params',
    });
    return out;
  }

  out.push({
    commandCode: 'B64',
    params: {
      mode: sett.ftpMode,
      username: sett.ftpUsername.trim(),
      password: sett.ftpPassword.trim(),
      host: sett.ftpHost.trim(),
      port: sett.ftpPort.trim() || '21',
      path: sett.ftpPath.trim(),
    },
    label: 'B64 FTP photo upload',
  });

  return out;
}

/** Empty GET probes (catalog: empty params = read). */
export function mediaReadbackCommands(): ComposedMediaCommand[] {
  return [
    { commandCode: 'BB8', params: {}, label: 'BB8 GET volume' },
    { commandCode: 'B64', params: {}, label: 'B64 GET FTP' },
  ];
}

export function mergeFieldsIntoMediaSett(
  base: MediaParameterSett,
  fields: Record<string, string> | null | undefined,
  code: string,
): MediaParameterSett {
  if (!fields) return base;
  const next = { ...base };
  if (code === 'BB8' && fields.volume !== undefined) {
    const n = Number(fields.volume);
    if (Number.isFinite(n)) next.speakerVolume = Math.max(0, Math.min(100, Math.round(n)));
  }
  if (code === 'B64') {
    if (fields.mode === '0' || fields.mode === '1' || fields.mode === '2') {
      next.ftpMode = fields.mode;
    }
    if (fields.username !== undefined) next.ftpUsername = fields.username;
    if (fields.password !== undefined) next.ftpPassword = fields.password;
    if (fields.host !== undefined) next.ftpHost = fields.host;
    if (fields.port !== undefined) next.ftpPort = fields.port;
    if (fields.path !== undefined) next.ftpPath = fields.path;
  }
  return next;
}

export function mergeHistoryIntoMediaSett(
  base: MediaParameterSett,
  history: readonly CommandHistoryLike[],
): { sett: MediaParameterSett; changed: boolean } {
  let sett = { ...base };
  let changed = false;
  for (const code of ['BB8', 'B64'] as const) {
    const fields = lastStoredSettings(code, history);
    if (!fields) continue;
    const before = JSON.stringify(sett);
    sett = mergeFieldsIntoMediaSett(sett, fields, code);
    if (JSON.stringify(sett) !== before) changed = true;
  }
  return { sett, changed };
}

export function mergeReplyIntoMediaSett(
  base: MediaParameterSett,
  commandCode: string,
  responseText: string | null | undefined,
): { sett: MediaParameterSett; changed: boolean } {
  if (!responseText?.trim()) return { sett: base, changed: false };
  const fakeHistory: CommandHistoryLike[] = [
    {
      commandCode,
      status: 'ACKED',
      params: null,
      responseText,
    },
  ];
  return mergeHistoryIntoMediaSett(base, fakeHistory);
}

export function mediaCacheKey(deviceId: string): string {
  return parameterCacheKey('media', deviceId);
}

export function loadMediaSnapshot(deviceId: string): MediaParameterSnapshot {
  return loadParameterSnapshot(mediaCacheKey(deviceId), defaultMediaSett);
}

export function loadCachedMediaSett(deviceId: string): MediaParameterSett {
  return loadMediaSnapshot(deviceId).sett;
}

export function saveMediaSnapshot(deviceId: string, snapshot: MediaParameterSnapshot): void {
  saveParameterSnapshot(mediaCacheKey(deviceId), snapshot);
}

export function saveCachedMediaSett(
  deviceId: string,
  sett: MediaParameterSett,
  source: MediaSnapshotSource = 'set',
): void {
  saveMediaSnapshot(deviceId, stampParameterSnapshot(sett, source));
}

/** Returns a field key when invalid, else null. */
export function validateMediaSett(sett: MediaParameterSett): string | null {
  if (!Number.isFinite(sett.speakerVolume) || sett.speakerVolume < 0 || sett.speakerVolume > 100) {
    return 'speakerVolume';
  }
  if (sett.ftpMode === '1') {
    if (!sett.ftpHost.trim()) return 'ftpHost';
    const port = Number(sett.ftpPort);
    if (!Number.isFinite(port) || port < 1 || port > 65535) return 'ftpPort';
  }
  return null;
}

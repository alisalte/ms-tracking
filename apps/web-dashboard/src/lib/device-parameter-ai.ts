/**
 * Device Parameter → AI / C90 (Phase 4).
 *
 * DMS alert volume + behavior toggles (C90). Optional CD1 starts pose
 * calibration (action, not part of the persisted sett).
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

export type DmsAlertVolume = '0' | '1' | '2' | '225';
export type OnOffFlag = '0' | '1';

export interface AiParameterSett {
  volume: DmsAlertVolume;
  absence: OnOffFlag;
  distraction: OnOffFlag;
  smoking: OnOffFlag;
  phoneCall: OnOffFlag;
}

export type AiSnapshotSource = ParameterSnapshotSource;
export type AiParameterSnapshot = ParameterSnapshot<AiParameterSett>;

export interface ComposedAiCommand {
  commandCode: string;
  params: Record<string, string | number>;
  label: string;
}

const VOLUME_VALUES = new Set<string>(['0', '1', '2', '225']);

function asOnOff(value: string | undefined, fallback: OnOffFlag): OnOffFlag {
  return value === '0' || value === '1' ? value : fallback;
}

export function defaultAiSett(): AiParameterSett {
  return {
    volume: '2',
    absence: '1',
    distraction: '1',
    smoking: '1',
    phoneCall: '1',
  };
}

export function composeAiCommands(sett: AiParameterSett): ComposedAiCommand[] {
  return [
    {
      commandCode: 'C90',
      params: {
        volume: sett.volume,
        absence: sett.absence,
        distraction: sett.distraction,
        smoking: sett.smoking,
        phoneCall: sett.phoneCall,
      },
      label: 'C90 DMS alerts',
    },
  ];
}

/** Empty GET probe (catalog: empty params = read). */
export function aiReadbackCommands(): ComposedAiCommand[] {
  return [{ commandCode: 'C90', params: {}, label: 'C90 GET DMS' }];
}

export function composeDmsCalibrationCommand(): ComposedAiCommand {
  return {
    commandCode: 'CD1',
    params: { action: '1' },
    label: 'CD1 DMS calibration',
  };
}

export function mergeFieldsIntoAiSett(
  base: AiParameterSett,
  fields: Record<string, string> | null | undefined,
): AiParameterSett {
  if (!fields) return base;
  const next = { ...base };
  if (fields.volume !== undefined && VOLUME_VALUES.has(fields.volume)) {
    next.volume = fields.volume as DmsAlertVolume;
  }
  if (fields.absence !== undefined) next.absence = asOnOff(fields.absence, next.absence);
  if (fields.distraction !== undefined) {
    next.distraction = asOnOff(fields.distraction, next.distraction);
  }
  if (fields.smoking !== undefined) next.smoking = asOnOff(fields.smoking, next.smoking);
  if (fields.phoneCall !== undefined) next.phoneCall = asOnOff(fields.phoneCall, next.phoneCall);
  return next;
}

export function mergeHistoryIntoAiSett(
  base: AiParameterSett,
  history: readonly CommandHistoryLike[],
): { sett: AiParameterSett; changed: boolean } {
  const fields = lastStoredSettings('C90', history);
  if (!fields) return { sett: base, changed: false };
  const sett = mergeFieldsIntoAiSett(base, fields);
  return { sett, changed: JSON.stringify(sett) !== JSON.stringify(base) };
}

export function mergeReplyIntoAiSett(
  base: AiParameterSett,
  responseText: string | null | undefined,
): { sett: AiParameterSett; changed: boolean } {
  if (!responseText?.trim()) return { sett: base, changed: false };
  return mergeHistoryIntoAiSett(base, [
    {
      commandCode: 'C90',
      status: 'ACKED',
      params: null,
      responseText,
    },
  ]);
}

export function aiCacheKey(deviceId: string): string {
  return parameterCacheKey('ai', deviceId);
}

export function loadAiSnapshot(deviceId: string): AiParameterSnapshot {
  return loadParameterSnapshot(aiCacheKey(deviceId), defaultAiSett);
}

export function loadCachedAiSett(deviceId: string): AiParameterSett {
  return loadAiSnapshot(deviceId).sett;
}

export function saveAiSnapshot(deviceId: string, snapshot: AiParameterSnapshot): void {
  saveParameterSnapshot(aiCacheKey(deviceId), snapshot);
}

export function saveCachedAiSett(
  deviceId: string,
  sett: AiParameterSett,
  source: AiSnapshotSource = 'set',
): void {
  saveAiSnapshot(deviceId, stampParameterSnapshot(sett, source));
}

export function validateAiSett(sett: AiParameterSett): string | null {
  if (!VOLUME_VALUES.has(sett.volume)) return 'volume';
  for (const key of ['absence', 'distraction', 'smoking', 'phoneCall'] as const) {
    if (sett[key] !== '0' && sett[key] !== '1') return key;
  }
  return null;
}

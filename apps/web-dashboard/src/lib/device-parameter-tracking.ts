/**
 * Device Parameter → Tracking+ (A13 / A14 / A16).
 *
 * Cornering angle, distance tracking, and parking-schedule enable.
 * A12/A15 intervals remain under Network. Readback via DB4 + history.
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

export type OnOffFlag = '0' | '1';

export interface TrackingParameterSett {
  /** A13 degrees; 0 disables. */
  cornerAngle: number;
  /** A14 meters; 0 disables. */
  distanceMeters: number;
  /** A16: use A15 while engine off. */
  parkingTrackingEnabled: OnOffFlag;
}

export type TrackingSnapshotSource = ParameterSnapshotSource;
export type TrackingParameterSnapshot = ParameterSnapshot<TrackingParameterSett>;

export interface ComposedTrackingCommand {
  commandCode: string;
  params: Record<string, string | number>;
  label: string;
}

export function defaultTrackingSett(): TrackingParameterSett {
  return {
    cornerAngle: 30,
    distanceMeters: 300,
    parkingTrackingEnabled: '1',
  };
}

export function composeTrackingCommands(sett: TrackingParameterSett): ComposedTrackingCommand[] {
  return [
    {
      commandCode: 'A13',
      params: { angle: Math.max(0, Math.min(359, Math.round(sett.cornerAngle))) },
      label: 'A13 cornering',
    },
    {
      commandCode: 'A14',
      params: { distance: Math.max(0, Math.min(65535, Math.round(sett.distanceMeters))) },
      label: 'A14 distance',
    },
    {
      commandCode: 'A16',
      params: { status: sett.parkingTrackingEnabled },
      label: 'A16 parking tracking',
    },
  ];
}

export function trackingReadbackCommands(): ComposedTrackingCommand[] {
  return [{ commandCode: 'DB4', params: {}, label: 'DB4 settings dump' }];
}

export function mergeFieldsIntoTrackingSett(
  base: TrackingParameterSett,
  fields: Record<string, string> | null | undefined,
  code: string,
): TrackingParameterSett {
  if (!fields) return base;
  const next = { ...base };
  switch (code) {
    case 'A13':
      if (fields.angle !== undefined) {
        const n = Number(fields.angle);
        if (Number.isFinite(n)) next.cornerAngle = Math.max(0, Math.min(359, Math.round(n)));
      }
      break;
    case 'A14':
      if (fields.distance !== undefined) {
        const n = Number(fields.distance);
        if (Number.isFinite(n)) next.distanceMeters = Math.max(0, Math.min(65535, Math.round(n)));
      }
      break;
    case 'A16':
      if (fields.status === '0' || fields.status === '1') {
        next.parkingTrackingEnabled = fields.status;
      }
      break;
    default:
      break;
  }
  return next;
}

export function mergeHistoryIntoTrackingSett(
  base: TrackingParameterSett,
  history: readonly CommandHistoryLike[],
): { sett: TrackingParameterSett; changed: boolean } {
  let sett = { ...base };
  let changed = false;
  for (const code of ['A13', 'A14', 'A16'] as const) {
    const fields = lastStoredSettings(code, history);
    if (!fields) continue;
    const before = JSON.stringify(sett);
    sett = mergeFieldsIntoTrackingSett(sett, fields, code);
    if (JSON.stringify(sett) !== before) changed = true;
  }
  return { sett, changed };
}

export function mergeDb4ReplyIntoTrackingSett(
  base: TrackingParameterSett,
  responseText: string | null | undefined,
): { sett: TrackingParameterSett; changed: boolean } {
  if (!responseText?.trim()) return { sett: base, changed: false };
  return mergeHistoryIntoTrackingSett(base, [
    {
      commandCode: 'DB4',
      status: 'ACKED',
      params: null,
      responseText,
    },
  ]);
}

export function trackingCacheKey(deviceId: string): string {
  return parameterCacheKey('tracking', deviceId);
}

export function loadTrackingSnapshot(deviceId: string): TrackingParameterSnapshot {
  return loadParameterSnapshot(trackingCacheKey(deviceId), defaultTrackingSett);
}

export function loadCachedTrackingSett(deviceId: string): TrackingParameterSett {
  return loadTrackingSnapshot(deviceId).sett;
}

export function saveTrackingSnapshot(deviceId: string, snapshot: TrackingParameterSnapshot): void {
  saveParameterSnapshot(trackingCacheKey(deviceId), snapshot);
}

export function saveCachedTrackingSett(
  deviceId: string,
  sett: TrackingParameterSett,
  source: TrackingSnapshotSource = 'set',
): void {
  saveTrackingSnapshot(deviceId, stampParameterSnapshot(sett, source));
}

export function validateTrackingSett(sett: TrackingParameterSett): string | null {
  if (!Number.isFinite(sett.cornerAngle) || sett.cornerAngle < 0 || sett.cornerAngle > 359) {
    return 'cornerAngle';
  }
  if (
    !Number.isFinite(sett.distanceMeters) ||
    sett.distanceMeters < 0 ||
    sett.distanceMeters > 65535
  ) {
    return 'distanceMeters';
  }
  if (sett.parkingTrackingEnabled !== '0' && sett.parkingTrackingEnabled !== '1') {
    return 'parkingTrackingEnabled';
  }
  return null;
}

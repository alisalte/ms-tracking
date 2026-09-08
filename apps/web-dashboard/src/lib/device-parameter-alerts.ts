/**
 * Device Parameter → Alerts+ (B07 / B10 / D79 / C03).
 *
 * Speeding, towing (fast B10), harsh accel/brake, GPRS event mode.
 * B08 is covered by B10's vibration seconds. Live readback is limited —
 * B07 overspeed comes from DB4; others from last SET history.
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

export type GprsEventMode = '0' | '1';

export interface AlertsParameterSett {
  /** B07 km/h; 0 disables. */
  speedKmh: number;
  /** B10 vibration seconds; 0 disables. */
  towingSeconds: number;
  /** B10 idle minutes before power-save. */
  towingIdleMinutes: number;
  /** D79 harsh acceleration (mG), 90–1000. */
  harshAcceleration: number;
  /** D79 harsh braking (mG), −1500…−100. */
  harshBraking: number;
  /** C03: 0 automatic, 1 confirmed UDP. */
  gprsEventMode: GprsEventMode;
}

export type AlertsSnapshotSource = ParameterSnapshotSource;
export type AlertsParameterSnapshot = ParameterSnapshot<AlertsParameterSett>;

export interface ComposedAlertsCommand {
  commandCode: string;
  params: Record<string, string | number>;
  label: string;
}

export function defaultAlertsSett(): AlertsParameterSett {
  return {
    speedKmh: 60,
    towingSeconds: 3,
    towingIdleMinutes: 2,
    harshAcceleration: 150,
    harshBraking: -180,
    gprsEventMode: '0',
  };
}

export function composeAlertsCommands(sett: AlertsParameterSett): ComposedAlertsCommand[] {
  return [
    {
      commandCode: 'B07',
      params: { speed: Math.max(0, Math.min(255, Math.round(sett.speedKmh))) },
      label: 'B07 speeding',
    },
    {
      commandCode: 'B10',
      params: {
        seconds: Math.max(0, Math.min(255, Math.round(sett.towingSeconds))),
        idleMinutes: Math.max(0, Math.min(255, Math.round(sett.towingIdleMinutes))),
      },
      label: 'B10 towing',
    },
    {
      commandCode: 'D79',
      params: {
        acceleration: Math.max(90, Math.min(1000, Math.round(sett.harshAcceleration))),
        braking: Math.max(-1500, Math.min(-100, Math.round(sett.harshBraking))),
      },
      label: 'D79 harsh accel/brake',
    },
    {
      commandCode: 'C03',
      params: { mode: sett.gprsEventMode },
      label: 'C03 GPRS event mode',
    },
  ];
}

/** DB4 dump fills B07 overspeed; other fields rely on history after probe. */
export function alertsReadbackCommands(): ComposedAlertsCommand[] {
  return [{ commandCode: 'DB4', params: {}, label: 'DB4 settings dump' }];
}

export function mergeFieldsIntoAlertsSett(
  base: AlertsParameterSett,
  fields: Record<string, string> | null | undefined,
  code: string,
): AlertsParameterSett {
  if (!fields) return base;
  const next = { ...base };
  switch (code) {
    case 'B07':
      if (fields.speed !== undefined) {
        const n = Number(fields.speed);
        if (Number.isFinite(n)) next.speedKmh = Math.max(0, Math.min(255, Math.round(n)));
      }
      break;
    case 'B08':
      if (fields.seconds !== undefined) {
        const n = Number(fields.seconds);
        if (Number.isFinite(n)) next.towingSeconds = Math.max(0, Math.min(255, Math.round(n)));
      }
      break;
    case 'B10':
      if (fields.seconds !== undefined) {
        const n = Number(fields.seconds);
        if (Number.isFinite(n)) next.towingSeconds = Math.max(0, Math.min(255, Math.round(n)));
      }
      if (fields.idleMinutes !== undefined) {
        const n = Number(fields.idleMinutes);
        if (Number.isFinite(n)) next.towingIdleMinutes = Math.max(0, Math.min(255, Math.round(n)));
      }
      break;
    case 'D79':
      if (fields.acceleration !== undefined) {
        const n = Number(fields.acceleration);
        if (Number.isFinite(n)) {
          next.harshAcceleration = Math.max(90, Math.min(1000, Math.round(n)));
        }
      }
      if (fields.braking !== undefined) {
        const n = Number(fields.braking);
        if (Number.isFinite(n)) {
          next.harshBraking = Math.max(-1500, Math.min(-100, Math.round(n)));
        }
      }
      break;
    case 'C03':
      if (fields.mode === '0' || fields.mode === '1') next.gprsEventMode = fields.mode;
      break;
    default:
      break;
  }
  return next;
}

export function mergeHistoryIntoAlertsSett(
  base: AlertsParameterSett,
  history: readonly CommandHistoryLike[],
): { sett: AlertsParameterSett; changed: boolean } {
  let sett = { ...base };
  let changed = false;
  for (const code of ['B07', 'B10', 'B08', 'D79', 'C03'] as const) {
    const fields = lastStoredSettings(code, history);
    if (!fields) continue;
    const before = JSON.stringify(sett);
    sett = mergeFieldsIntoAlertsSett(sett, fields, code);
    if (JSON.stringify(sett) !== before) changed = true;
  }
  return { sett, changed };
}

export function mergeDb4ReplyIntoAlertsSett(
  base: AlertsParameterSett,
  responseText: string | null | undefined,
): { sett: AlertsParameterSett; changed: boolean } {
  if (!responseText?.trim()) return { sett: base, changed: false };
  return mergeHistoryIntoAlertsSett(base, [
    {
      commandCode: 'DB4',
      status: 'ACKED',
      params: null,
      responseText,
    },
  ]);
}

export function alertsCacheKey(deviceId: string): string {
  return parameterCacheKey('alerts', deviceId);
}

export function loadAlertsSnapshot(deviceId: string): AlertsParameterSnapshot {
  return loadParameterSnapshot(alertsCacheKey(deviceId), defaultAlertsSett);
}

export function loadCachedAlertsSett(deviceId: string): AlertsParameterSett {
  return loadAlertsSnapshot(deviceId).sett;
}

export function saveAlertsSnapshot(deviceId: string, snapshot: AlertsParameterSnapshot): void {
  saveParameterSnapshot(alertsCacheKey(deviceId), snapshot);
}

export function saveCachedAlertsSett(
  deviceId: string,
  sett: AlertsParameterSett,
  source: AlertsSnapshotSource = 'set',
): void {
  saveAlertsSnapshot(deviceId, stampParameterSnapshot(sett, source));
}

export function validateAlertsSett(sett: AlertsParameterSett): string | null {
  if (!Number.isFinite(sett.speedKmh) || sett.speedKmh < 0 || sett.speedKmh > 255) {
    return 'speedKmh';
  }
  if (!Number.isFinite(sett.towingSeconds) || sett.towingSeconds < 0 || sett.towingSeconds > 255) {
    return 'towingSeconds';
  }
  if (
    !Number.isFinite(sett.towingIdleMinutes) ||
    sett.towingIdleMinutes < 0 ||
    sett.towingIdleMinutes > 255
  ) {
    return 'towingIdleMinutes';
  }
  if (
    !Number.isFinite(sett.harshAcceleration) ||
    sett.harshAcceleration < 90 ||
    sett.harshAcceleration > 1000
  ) {
    return 'harshAcceleration';
  }
  if (
    !Number.isFinite(sett.harshBraking) ||
    sett.harshBraking < -1500 ||
    sett.harshBraking > -100
  ) {
    return 'harshBraking';
  }
  if (sett.gprsEventMode !== '0' && sett.gprsEventMode !== '1') return 'gprsEventMode';
  return null;
}

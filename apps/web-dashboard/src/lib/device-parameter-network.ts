/**
 * Device Parameter → Network (Phase 2A).
 *
 * Composite form for primary/backup GPRS + heartbeat/tracking intervals.
 * Maps to A21 / A23 / A11 / A12 / A15. Readback via DB4 + lastStoredSettings.
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

export type GprsMode = '0' | '1' | '2';

export interface NetworkParameterSett {
  mode: GprsMode;
  host: string;
  port: string;
  apn: string;
  apnUser: string;
  apnPassword: string;
  backupHost: string;
  backupPort: string;
  heartbeatMinutes: number;
  /** A12 interval (device unit ×10s). */
  trackingInterval: number;
  /** A15 interval (device unit ×10s). */
  parkingInterval: number;
}

export type NetworkSnapshotSource = ParameterSnapshotSource;
export type NetworkParameterSnapshot = ParameterSnapshot<NetworkParameterSett>;

export interface ComposedNetworkCommand {
  commandCode: string;
  params: Record<string, string | number>;
  label: string;
}

export function defaultNetworkSett(): NetworkParameterSett {
  return {
    mode: '1',
    host: '',
    port: '6180',
    apn: '',
    apnUser: '',
    apnPassword: '',
    backupHost: '',
    backupPort: '',
    heartbeatMinutes: 10,
    trackingInterval: 6,
    parkingInterval: 6,
  };
}

/** Ordered apply list: server first, then intervals. */
export function composeNetworkCommands(sett: NetworkParameterSett): ComposedNetworkCommand[] {
  const out: ComposedNetworkCommand[] = [];

  out.push({
    commandCode: 'A21',
    params: {
      mode: sett.mode,
      host: sett.host.trim(),
      port: Number(sett.port) || 0,
      apn: sett.apn.trim(),
      apnUser: sett.apnUser.trim(),
      apnPassword: sett.apnPassword.trim(),
    },
    label: 'A21 primary server',
  });

  const backupHost = sett.backupHost.trim();
  const backupPort = sett.backupPort.trim();
  if (backupHost || backupPort) {
    out.push({
      commandCode: 'A23',
      params: {
        host: backupHost,
        port: Number(backupPort) || 0,
      },
      label: 'A23 backup server',
    });
  }

  out.push({
    commandCode: 'A11',
    params: { minutes: Math.max(0, Math.round(sett.heartbeatMinutes)) },
    label: 'A11 heartbeat',
  });
  out.push({
    commandCode: 'A12',
    params: { interval: Math.max(0, Math.round(sett.trackingInterval)) },
    label: 'A12 tracking interval',
  });
  out.push({
    commandCode: 'A15',
    params: { interval: Math.max(0, Math.round(sett.parkingInterval)) },
    label: 'A15 parking interval',
  });

  return out;
}

export function networkReadbackCommands(): ComposedNetworkCommand[] {
  return [{ commandCode: 'DB4', params: {}, label: 'DB4 settings dump' }];
}

export function mergeFieldsIntoNetworkSett(
  base: NetworkParameterSett,
  fields: Record<string, string> | null | undefined,
  code: string,
): NetworkParameterSett {
  if (!fields) return base;
  const next = { ...base };
  switch (code) {
    case 'A21':
      if (fields.mode === '0' || fields.mode === '1' || fields.mode === '2') {
        next.mode = fields.mode;
      }
      if (fields.host !== undefined) next.host = fields.host;
      if (fields.port !== undefined) next.port = fields.port;
      if (fields.apn !== undefined) next.apn = fields.apn;
      if (fields.apnUser !== undefined) next.apnUser = fields.apnUser;
      if (fields.apnPassword !== undefined) next.apnPassword = fields.apnPassword;
      break;
    case 'A23':
      if (fields.host !== undefined) next.backupHost = fields.host;
      if (fields.port !== undefined) next.backupPort = fields.port;
      break;
    case 'A11':
      if (fields.minutes !== undefined) {
        next.heartbeatMinutes = Number(fields.minutes) || 0;
      }
      break;
    case 'A12':
      if (fields.interval !== undefined) {
        next.trackingInterval = Number(fields.interval) || 0;
      }
      break;
    case 'A15':
      if (fields.interval !== undefined) {
        next.parkingInterval = Number(fields.interval) || 0;
      }
      break;
    default:
      break;
  }
  return next;
}

/** Merge DB4 dump / history into a Network sett via lastStoredSettings. */
export function mergeHistoryIntoNetworkSett(
  base: NetworkParameterSett,
  history: readonly CommandHistoryLike[],
): { sett: NetworkParameterSett; changed: boolean } {
  let sett = { ...base };
  let changed = false;
  for (const code of ['A21', 'A23', 'A11', 'A12', 'A15'] as const) {
    const fields = lastStoredSettings(code, history);
    if (!fields) continue;
    const before = JSON.stringify(sett);
    sett = mergeFieldsIntoNetworkSett(sett, fields, code);
    if (JSON.stringify(sett) !== before) changed = true;
  }
  return { sett, changed };
}

/** Apply a raw DB4 (or DA6) response text into the sett. */
export function mergeDb4ReplyIntoNetworkSett(
  base: NetworkParameterSett,
  responseText: string | null | undefined,
): { sett: NetworkParameterSett; changed: boolean } {
  if (!responseText?.trim()) return { sett: base, changed: false };
  const fakeHistory: CommandHistoryLike[] = [
    {
      commandCode: 'DB4',
      status: 'ACKED',
      params: null,
      responseText,
    },
  ];
  return mergeHistoryIntoNetworkSett(base, fakeHistory);
}

export function networkCacheKey(deviceId: string): string {
  return parameterCacheKey('network', deviceId);
}

export function loadNetworkSnapshot(deviceId: string): NetworkParameterSnapshot {
  return loadParameterSnapshot(networkCacheKey(deviceId), defaultNetworkSett);
}

export function loadCachedNetworkSett(deviceId: string): NetworkParameterSett {
  return loadNetworkSnapshot(deviceId).sett;
}

export function saveNetworkSnapshot(deviceId: string, snapshot: NetworkParameterSnapshot): void {
  saveParameterSnapshot(networkCacheKey(deviceId), snapshot);
}

export function saveCachedNetworkSett(
  deviceId: string,
  sett: NetworkParameterSett,
  source: NetworkSnapshotSource = 'set',
): void {
  saveNetworkSnapshot(deviceId, stampParameterSnapshot(sett, source));
}

export function validateNetworkSett(sett: NetworkParameterSett): string | null {
  if (!sett.host.trim()) return 'host';
  const port = Number(sett.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return 'port';
  if (sett.backupHost.trim() || sett.backupPort.trim()) {
    const bp = Number(sett.backupPort);
    if (sett.backupHost.trim() && (!Number.isFinite(bp) || bp < 1 || bp > 65535)) {
      return 'backupPort';
    }
  }
  return null;
}

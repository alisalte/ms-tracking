/**
 * Alarm evidence helpers — location, DMS flags, and the ±5 minute recording
 * window used to look up MDVR SD-card clips around `raisedAt`.
 */
import { isMdvrChannel } from '@/components/video/useStreamSession';
import type { Alarm } from '@/types/alarm.types';
import type { CameraChannel } from '@/types/video.types';

/** Inclusive window around the alarm for stored video / photo lookup. */
export const ALARM_EVIDENCE_TOLERANCE_MS = 5 * 60 * 1000;

export function hasAlarmCoordinates(alarm: Pick<Alarm, 'lat' | 'lng'>): boolean {
  return (
    Number.isFinite(alarm.lat) && Number.isFinite(alarm.lng) && (alarm.lat !== 0 || alarm.lng !== 0)
  );
}

export function alarmEvidenceWindow(
  raisedAt: string,
  toleranceMs = ALARM_EVIDENCE_TOLERANCE_MS,
): { fromMs: number; toMs: number } | null {
  const t = new Date(raisedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return { fromMs: t - toleranceMs, toMs: t + toleranceMs };
}

export function isDmsAlarm(alarm: Pick<Alarm, 'type' | 'code' | 'rawType'>): boolean {
  if (alarm.type === 'dms') return true;
  const blob = `${alarm.rawType ?? ''} ${alarm.code ?? ''}`.toUpperCase();
  return /\bDMS_/.test(blob) || blob.includes('ADAS_') || blob.includes('FATIGUE');
}

export function parseAlarmDetailJson(detail: string): Record<string, unknown> | null {
  const raw = detail?.trim() ?? '';
  if (!raw.startsWith('{')) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function alarmEventPhotoName(detail: string): string | undefined {
  const obj = parseAlarmDetailJson(detail);
  const name = obj?.photoName;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

/** MDVR cameras bound to this vehicle (the only recording path we can query). */
export function mdvrChannelsForVehicle(
  channels: CameraChannel[],
  vehicleId: string,
): CameraChannel[] {
  if (!vehicleId) return [];
  return channels.filter((c) => isMdvrChannel(c) && c.sourceId === vehicleId);
}

/** Cabin / driver camera first — DMS evidence lives there. */
export function sortEvidenceChannels(channels: CameraChannel[]): CameraChannel[] {
  return [...channels].sort((a, b) => {
    if (a.cabinCam !== b.cabinCam) return a.cabinCam ? -1 : 1;
    return (a.logicalChannel ?? 99) - (b.logicalChannel ?? 99);
  });
}

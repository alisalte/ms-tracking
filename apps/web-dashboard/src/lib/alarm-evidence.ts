/**
 * Alarm evidence helpers — location, DMS flags, and the ±5 minute recording
 * window used to look up MDVR SD-card clips around `raisedAt`.
 *
 * Regular alarms: operator opts in to list whatever video/photo is already
 * stored in that window. DMS: we always surface the event snapshot + clip the
 * device created for that alarm (eventCode 126 / photoName / short overlap).
 */
import { fromMdvrBcdTime, mdvrResourceKind } from '@/api/video.api';
import { isMdvrChannel } from '@/components/video/useStreamSession';
import type { Alarm } from '@/types/alarm.types';
import type { CameraChannel } from '@/types/video.types';

/** Inclusive window around the alarm for stored video / photo lookup. */
export const ALARM_EVIDENCE_TOLERANCE_MS = 5 * 60 * 1000;

/** Meitrack CCE event 126 = DMS/ADAS (the device tags event files with this). */
export const DMS_DEVICE_EVENT_CODE = 126;

/** Short event clips (not continuous recording) attributed to the alarm. */
export const ALARM_EVENT_CLIP_MAX_MS = 3 * 60 * 1000;

/** Clock slop between `raisedAt` and the SD-card file start. */
export const ALARM_EVENT_TIME_SLOP_MS = 90 * 1000;

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

export function isDmsAlarm(
  alarm: Pick<Alarm, 'type' | 'code' | 'rawType'> &
    Partial<Pick<Alarm, 'message' | 'detail' | 'sourceEvents'>>,
): boolean {
  if (alarm.type === 'dms') return true;
  const bits = [
    alarm.rawType,
    alarm.code,
    alarm.message,
    alarm.detail,
    ...(alarm.sourceEvents ?? []).flatMap((event) => [event.type, event.detail]),
  ];
  const blob = bits.filter(Boolean).join(' ').toUpperCase();
  return (
    /\bDMS_/.test(blob) ||
    blob.includes('ADAS_') ||
    blob.includes('FATIGUE') ||
    /DEVICE\.ALARM\.DMS/.test(blob) ||
    /_E126S\d/.test(blob)
  );
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

function stringField(obj: Record<string, unknown> | null, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nestedObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function photoNameFromObject(obj: Record<string, unknown> | null): string | undefined {
  if (!obj) return undefined;
  const direct = stringField(obj, 'photoName');
  if (direct) return direct;
  const nested = nestedObject(obj.lastDetection);
  return nested ? photoNameFromObject(nested) : undefined;
}

export function alarmEventPhotoName(detail: string): string | undefined {
  return photoNameFromObject(parseAlarmDetailJson(detail));
}

/** Fields the MDVR uses to tag files created for this alarm. */
export interface AlarmEventMediaHint {
  photoName?: string;
  eventCode?: number;
  subEventCode?: number;
}

function numberField(obj: Record<string, unknown> | null, ...keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    const n =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

function hintFromObject(obj: Record<string, unknown> | null): AlarmEventMediaHint {
  return {
    photoName: photoNameFromObject(obj),
    eventCode: numberField(obj, 'source', 'eventCode', 'event'),
    subEventCode: numberField(obj, 'dmsAlarmType', 'subEventCode', 'alarmType'),
  };
}

function mergeHint(into: AlarmEventMediaHint, from: AlarmEventMediaHint): AlarmEventMediaHint {
  return {
    photoName: into.photoName ?? from.photoName,
    eventCode: into.eventCode ?? from.eventCode,
    subEventCode: into.subEventCode ?? from.subEventCode,
  };
}

/** photoName / event 126 / DMS subtype from occurrence detail + source events. */
export function alarmEventMediaHint(
  alarm: Pick<Alarm, 'type' | 'code' | 'rawType' | 'detail' | 'sourceEvents'>,
): AlarmEventMediaHint {
  let hint = hintFromObject(parseAlarmDetailJson(alarm.detail));
  for (const event of alarm.sourceEvents) {
    hint = mergeHint(hint, hintFromObject(parseAlarmDetailJson(event.detail)));
  }
  if (isDmsAlarm(alarm) && hint.eventCode == null)
    hint = { ...hint, eventCode: DMS_DEVICE_EVENT_CODE };
  return hint;
}

export interface AlarmMediaResource {
  startTime: string;
  endTime: string;
  avType: number;
  eventCode: number;
  subEventCode: number;
}

/**
 * True when the SD-card file was created for this alarm (DMS snapshot / event
 * clip), not merely overlapping continuous recording in the ±5 minute window.
 */
export function isAlarmEventMedia(
  resource: AlarmMediaResource,
  hint: AlarmEventMediaHint,
  raisedAtMs: number,
): boolean {
  const start = fromMdvrBcdTime(resource.startTime);
  if (!Number.isFinite(start)) return false;
  const parsedEnd = fromMdvrBcdTime(resource.endTime);
  const end = Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start;
  const inWindow =
    start <= raisedAtMs + ALARM_EVIDENCE_TOLERANCE_MS &&
    end >= raisedAtMs - ALARM_EVIDENCE_TOLERANCE_MS;
  if (!inWindow) return false;

  if (resource.eventCode > 0) {
    if (hint.eventCode != null && resource.eventCode !== hint.eventCode) return false;
    if (
      hint.subEventCode != null &&
      resource.subEventCode > 0 &&
      resource.subEventCode !== hint.subEventCode
    ) {
      return false;
    }
    return true;
  }

  const closeToAlarm = Math.abs(start - raisedAtMs) <= ALARM_EVENT_TIME_SLOP_MS;
  if (mdvrResourceKind(resource.avType) === 'photo') return closeToAlarm;

  const duration = end - start;
  const overlapsAlarm = start <= raisedAtMs && raisedAtMs <= end;
  return duration > 0 && duration <= ALARM_EVENT_CLIP_MAX_MS && (overlapsAlarm || closeToAlarm);
}

export function selectAlarmEventClips<T extends { resource: AlarmMediaResource }>(
  clips: T[],
  hint: AlarmEventMediaHint,
  raisedAtMs: number,
): T[] {
  return clips.filter((clip) => isAlarmEventMedia(clip.resource, hint, raisedAtMs));
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

/** Meitrack event snapshot name: `240823120009_CH2_E126S8_0.jpg`. */
export interface MdvrEventPhotoRef {
  filename: string;
  bcdTime: string;
  capturedAtMs: number;
  channel: number;
  eventCode: number;
  subEventCode: number;
}

export function parseMdvrEventPhotoName(name: string | undefined): MdvrEventPhotoRef | null {
  const filename = name?.trim() ?? '';
  if (!filename) return null;
  const tagged = filename.match(/^(\d{12})_CH(\d+)_E(\d+)S(\d+)/i);
  if (tagged) {
    const bcdTime = tagged[1] ?? '';
    return {
      filename,
      bcdTime,
      capturedAtMs: fromMdvrBcdTime(bcdTime),
      channel: Number(tagged[2]),
      eventCode: Number(tagged[3]),
      subEventCode: Number(tagged[4]),
    };
  }
  const timed = filename.match(/^(\d{12})/);
  const bcdTime = timed?.[1] ?? '';
  return {
    filename,
    bcdTime,
    capturedAtMs: bcdTime ? fromMdvrBcdTime(bcdTime) : Number.NaN,
    channel: 0,
    eventCode: 0,
    subEventCode: 0,
  };
}

/** Short playback window around the event snapshot (or `raisedAt`). */
export function alarmEventVideoWindow(
  photo: MdvrEventPhotoRef | null,
  raisedAt: string,
): { fromMs: number; toMs: number } | null {
  const t =
    photo && Number.isFinite(photo.capturedAtMs)
      ? photo.capturedAtMs
      : new Date(raisedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return { fromMs: t - 15_000, toMs: t + 45_000 };
}

export function evidenceChannelForPhoto(
  channels: CameraChannel[],
  photo: MdvrEventPhotoRef | null,
): CameraChannel | undefined {
  if (photo && photo.channel > 0) {
    const match = channels.find((c) => c.logicalChannel === photo.channel);
    if (match) return match;
  }
  return channels[0];
}

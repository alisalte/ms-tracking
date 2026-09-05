/**
 * Locale-aware copy for alarms, events, and notifications.
 *
 * Backend records persist English headlines (rule evaluators + `Device alarm CODE`).
 * The dashboard re-renders those strings from type/code + i18n so FA/EN stay in
 * sync without rewriting historical rows.
 */
import type { TFunction } from 'i18next';

import type { Alarm, AlarmType } from '@/types/alarm.types';
import type { Notification } from '@/types/notification.types';

export const ALARM_CATALOG_TYPES: readonly AlarmType[] = [
  'sos',
  'dms',
  'overspeed',
  'geofence',
  'offline',
  'fuel-theft',
  'temperature',
  'collision',
  'camera',
  'idle',
  'ignition',
  'battery',
  'tow',
  'power',
  'jamming',
  'other',
];

/** English DMS/ADAS detail → canonical code (Meitrack 0xFE31 tables). */
const DMS_DETAIL_TO_CODE: Readonly<Record<string, string>> = {
  'eyes closed': 'DMS_EYES_CLOSED',
  yawning: 'DMS_YAWNING',
  'head lowered': 'DMS_HEAD_DOWN',
  'looking left/right': 'DMS_LOOKING_SIDE',
  'driver absence': 'DMS_DRIVER_ABSENCE',
  'phone call': 'DMS_PHONE_CALL',
  smoking: 'DMS_SMOKING',
  'camera occlusion': 'DMS_CAMERA_OCCLUSION',
  'forward collision warning': 'ADAS_FCW',
  'urban forward collision warning': 'ADAS_UFCW',
  'left lane departure': 'ADAS_LDW_LEFT',
  'right lane departure': 'ADAS_LDW_RIGHT',
  'headway monitoring warning': 'ADAS_HMW',
  'time-to-collision 1': 'ADAS_TTC1',
  'time-to-collision 2': 'ADAS_TTC2',
  'looking left': 'DMS_LOOK_LEFT',
  'looking right': 'DMS_LOOK_RIGHT',
  'head raised': 'DMS_HEAD_UP',
  drowsiness: 'DMS_DROWSINESS',
  drinking: 'DMS_DRINKING',
  'distance detection': 'ADAS_DISTANCE_DETECTION',
  'front vehicle started': 'ADAS_FRONT_VEHICLE_STARTED',
};

/**
 * Backend rule types / Meitrack codes → the UI catalog the filters, icons,
 * and `alarms.type.*` translations are keyed on.
 */
export function mapAlarmType(raw: string | undefined): AlarmType {
  const u = (raw ?? 'other').toUpperCase().replace(/-/g, '_');
  if (u === 'SOS') return 'sos';
  if (u === 'OVERSPEED') return 'overspeed';
  if (u.startsWith('GEOFENCE')) return 'geofence';
  if (u === 'DEVICE_OFFLINE' || u === 'DEVICE_ONLINE' || u === 'OFFLINE') return 'offline';
  if (u === 'FUEL_THEFT' || u === 'FUEL_LOW' || u === 'FUEL_FULL' || u === 'FUEL_FILLING') {
    return 'fuel-theft';
  }
  if (u === 'TEMPERATURE_HIGH' || u === 'TEMPERATURE_LOW' || u === 'TEMPERATURE') {
    return 'temperature';
  }
  if (
    u === 'ACCIDENT' ||
    u === 'COLLISION' ||
    u === 'BRAKING' ||
    u === 'ACCELERATION' ||
    u === 'CORNERING' ||
    u === 'DRIVING_BEHAVIOR'
  ) {
    return 'collision';
  }
  if (u.startsWith('VIDEO') || u.startsWith('STORAGE') || u === 'CAMERA') return 'camera';
  if (u.startsWith('ADAS') || u.startsWith('DMS') || u.startsWith('FATIGUE')) return 'dms';
  if (u === 'TOW') return 'tow';
  if (u === 'JAMMING') return 'jamming';
  if (u === 'POWER_CUT' || u === 'POWER_RESTORED' || u === 'LOW_POWER' || u === 'POWER') {
    return 'power';
  }
  if (u === 'LOW_BATTERY' || u === 'BATTERY') return 'battery';
  if (u === 'IGNITION_ON' || u === 'IGNITION_OFF' || u === 'IGNITION') return 'ignition';
  if (u === 'PROLONGED_IDLE' || u === 'PARKING' || u === 'IDLE') return 'idle';
  if (u === 'GPS_SIGNAL_LOST' || u === 'GPS_RECOVERED') return 'other';
  if (u.startsWith('EVENT_')) return 'other';
  if ((ALARM_CATALOG_TYPES as readonly string[]).includes(raw ?? '')) return raw as AlarmType;
  return 'other';
}

export function extractDeviceCode(message: string): string | undefined {
  const m = /^Device alarm ([A-Z][A-Z0-9_]*)(?:\s*[—–-]\s*.+)?$/i.exec(message.trim());
  return m?.[1]?.toUpperCase();
}

export function extractDeviceExtra(message: string): string | undefined {
  const m = /^Device alarm [A-Z][A-Z0-9_]*\s*[—–-]\s*(.+)$/i.exec(message.trim());
  const extra = m?.[1]?.trim();
  return extra || undefined;
}

export function localizeAlarmType(t: TFunction, type: AlarmType | string): string {
  return t(`alarms.type.${type}`, { defaultValue: humanizeCode(String(type)) });
}

export function localizeAlarmCode(t: TFunction, code: string): string {
  const event = /^EVENT_(\d+)$/i.exec(code);
  if (event)
    return t('alarms.codes.unknown', { code: event[1], defaultValue: `Event ${event[1]}` });
  return t(`alarms.codes.${code}`, { defaultValue: humanizeCode(code) });
}

export function localizePhrase(t: TFunction, phrase: string): string {
  const trimmed = phrase.trim();
  if (!trimmed) return trimmed;
  const asCode = trimmed.toUpperCase().replace(/\s+/g, '_');
  const fromCode = t(`alarms.codes.${asCode}`, { defaultValue: '' });
  if (fromCode && fromCode !== `alarms.codes.${asCode}`) return fromCode;
  const mapped = DMS_DETAIL_TO_CODE[trimmed.toLowerCase()];
  if (mapped) return localizeAlarmCode(t, mapped);
  return trimmed;
}

export function localizeAlarmMessage(
  t: TFunction,
  alarm: Pick<Alarm, 'type' | 'message' | 'detail' | 'code'>,
): string {
  const msg = alarm.message?.trim() ?? '';
  const code = alarm.code || extractDeviceCode(msg);
  if (code) {
    const head = localizeAlarmCode(t, code);
    const extra = extractDeviceExtra(msg);
    if (!extra) return head;
    const extraLabel = localizePhrase(t, extra);
    return extraLabel && extraLabel !== head ? `${head} — ${extraLabel}` : head;
  }
  const fromPattern = localizeEnglishPattern(t, msg);
  if (fromPattern) return fromPattern;
  if (msg) return msg;
  return localizeAlarmType(t, alarm.type);
}

export function localizeAlarmDetail(
  t: TFunction,
  alarm: Pick<Alarm, 'type' | 'message' | 'detail' | 'code' | 'rawType'>,
): string {
  const raw = alarm.detail?.trim() ?? '';
  if (!raw || raw === '{}' || raw === 'null') return '';
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const dms = typeof obj.dmsDetail === 'string' ? obj.dmsDetail : undefined;
      if (dms) return localizePhrase(t, dms);
      const speed = obj.speedKph ?? obj.speed;
      const limit = obj.limit ?? obj.speedLimit ?? obj.thresholdKmh;
      if (speed != null && limit != null) {
        return t('alarms.messages.overspeed', {
          speed: compactNum(speed),
          limit: compactNum(limit),
        });
      }
      const geo = typeof obj.geofenceName === 'string' ? obj.geofenceName : undefined;
      if (geo) {
        const kind = `${alarm.rawType ?? ''} ${alarm.type}`.toLowerCase();
        if (kind.includes('exit')) return t('alarms.messages.geofenceExit', { name: geo });
        if (kind.includes('dwell')) {
          return t('alarms.messages.geofenceDwell', {
            name: geo,
            minutes: String(obj.minutes ?? obj.dwellMin ?? ''),
          });
        }
        return t('alarms.messages.geofenceEnter', { name: geo });
      }
      const code = typeof obj.alarmCode === 'string' ? obj.alarmCode : alarm.code;
      if (code) return localizeAlarmCode(t, code);
      const fromMessage = localizeAlarmMessage(t, alarm);
      if (fromMessage) return fromMessage;
    } catch {
      /* keep raw */
    }
  }
  const fromPattern = localizeEnglishPattern(t, raw);
  if (fromPattern) return fromPattern;
  if (raw === alarm.message) return localizeAlarmMessage(t, alarm);
  return localizePhrase(t, raw);
}

export function localizeEventType(t: TFunction, eventType: string): string {
  const key = eventType.replace(/-/g, '_');
  const labeled = t(`notifications.eventTypes.${key}`, { defaultValue: '' });
  if (labeled && labeled !== `notifications.eventTypes.${key}`) return labeled;
  const asAlarm = mapAlarmType(eventType);
  if (asAlarm !== 'other' || eventType === 'other') return localizeAlarmType(t, asAlarm);
  return humanizeCode(eventType);
}

export function localizeNotificationTitle(
  t: TFunction,
  n: Pick<Notification, 'title' | 'eventType'>,
): string {
  const typeLabel = localizeEventType(t, n.eventType);
  const colon = n.title.indexOf(':');
  const vehicle = colon >= 0 ? n.title.slice(colon + 1).trim() : '';
  if (looksLocalized(n.title) && !looksEnglishAlarmTitle(n.title)) return n.title;
  const vehicleLooksLikeType =
    vehicle.toLowerCase().replace(/\s+/g, '_') === n.eventType.replace(/-/g, '_');
  if (vehicle && !looksEnglishAlarmTitle(vehicle) && !vehicleLooksLikeType) {
    return `${typeLabel}: ${vehicle}`;
  }
  return typeLabel;
}

export function localizeNotificationBody(
  t: TFunction,
  n: Pick<Notification, 'body' | 'eventType' | 'title'>,
): string {
  if (looksLocalized(n.body)) return n.body;
  const fromPattern = localizeEnglishPattern(t, n.body);
  if (fromPattern) return fromPattern;
  const extra = extractDeviceExtra(n.body) ?? extractDeviceExtra(n.title);
  if (extra) return localizePhrase(t, extra);
  const code = extractDeviceCode(n.body) ?? extractDeviceCode(n.title);
  if (code) return localizeAlarmCode(t, code);
  return n.body;
}

function looksLocalized(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function compactNum(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return Number.isInteger(n) ? String(n) : String(n);
}

function looksEnglishAlarmTitle(text: string): boolean {
  return /^(alarm|speeding|overspeed|geofence|device |ignition |trip |prolonged |unauthorized |low battery|notification|sos|dms|fuel|camera|collision|temperature|idle|tow|power|jamming|driver )/i.test(
    text.trim(),
  );
}

function humanizeCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/-/g, ' ').toLowerCase();
}

function localizeEnglishPattern(t: TFunction, msg: string): string | undefined {
  const s = msg.trim();
  if (!s) return undefined;

  let m = /^Vehicle exceeded speed limit:\s*([\d.]+)\s*km\/h\s*\(limit\s*([\d.]+)\s*km\/h\)$/i.exec(
    s,
  );
  if (m) {
    return t('alarms.messages.overspeed', { speed: compactNum(m[1]), limit: compactNum(m[2]) });
  }
  m = /^Entered geofence\s+(.+)$/i.exec(s);
  if (m) return t('alarms.messages.geofenceEnter', { name: m[1] });
  m = /^Exited geofence\s+(.+)$/i.exec(s);
  if (m) return t('alarms.messages.geofenceExit', { name: m[1] });
  m = /^Dwelt in geofence\s+(.+?)\s+for\s+(\d+)\s*min$/i.exec(s);
  if (m) return t('alarms.messages.geofenceDwell', { name: m[1], minutes: m[2] });
  if (/^Ignition turned on$/i.test(s)) return t('alarms.messages.ignitionOn');
  if (/^Ignition turned off$/i.test(s)) return t('alarms.messages.ignitionOff');
  m = /^Device went\s+(\w+)$/i.exec(s);
  if (m) {
    const state = m[1].toUpperCase();
    if (state === 'OFFLINE') return t('alarms.messages.deviceOffline');
    if (state === 'ONLINE') return t('alarms.messages.deviceOnline');
  }
  if (/^Trip started$/i.test(s)) return t('alarms.messages.tripStarted');
  m = /^Trip ended\s*\(([\d.]+)\s*km,\s*(\d+)s\)$/i.exec(s);
  if (m) return t('alarms.messages.tripEnded', { km: m[1], seconds: m[2] });
  m = /^Trip duration exceeded limit:\s*(\d+)s\s*\(max\s*(\d+)s\)$/i.exec(s);
  if (m) return t('alarms.messages.tripTooLong', { seconds: m[1], max: m[2] });
  m = /^Prolonged idle:\s*(\d+)\s*min\s*\(limit\s*(\d+)\s*min\)$/i.exec(s);
  if (m) return t('alarms.messages.idle', { minutes: m[1], limit: m[2] });
  m = /^Extended parking:\s*([\d.]+)\s*h\s*\(limit\s*([\d.]+)\s*h\)$/i.exec(s);
  if (m) return t('alarms.messages.parking', { hours: m[1], limit: m[2] });
  m =
    /^Vehicle .+ exceeded the speed limit\s*\(([\d.]+)\s*km\/h in a ([\d.]+)\s*km\/h zone\)\.?$/i.exec(
      s,
    );
  if (m) {
    return t('alarms.messages.vehicleOverspeed', { speed: m[1], speedLimit: m[2] });
  }
  m = /^Vehicle .+ entered geofence\s+(.+)\.?$/i.exec(s);
  if (m) return t('alarms.messages.geofenceEnter', { name: m[1].replace(/\.$/, '') });
  m = /^Vehicle .+ left geofence\s+(.+)\.?$/i.exec(s);
  if (m) return t('alarms.messages.geofenceExit', { name: m[1].replace(/\.$/, '') });
  m = /^The tracking device on vehicle .+ went offline\.?$/i.exec(s);
  if (m) return t('alarms.messages.deviceOffline');
  m = /^The tracking device on vehicle .+ is back online\.?$/i.exec(s);
  if (m) return t('alarms.messages.deviceOnline');
  m = /^Vehicle .+ ignition turned on\.?$/i.exec(s);
  if (m) return t('alarms.messages.ignitionOn');
  m = /^Vehicle .+ ignition turned off\.?$/i.exec(s);
  if (m) return t('alarms.messages.ignitionOff');
  if (/^Vehicle .+ started a trip\.?$/i.test(s)) return t('alarms.messages.tripStarted');
  if (/^Vehicle .+ ended its trip\.?$/i.test(s)) return t('alarms.messages.tripEndedShort');
  m = /^Vehicle .+ has been idling for\s+(.+)\.?$/i.exec(s);
  if (m) return t('alarms.messages.vehicleIdle', { duration: m[1].replace(/\.$/, '') });
  if (/^Emergency SOS from /i.test(s) || /^Device stopped reporting$/i.test(s)) {
    return /^Emergency SOS/i.test(s)
      ? t('alarms.messages.sosFrom')
      : t('alarms.messages.deviceOffline');
  }
  m = /^Device alarm ([A-Z][A-Z0-9_]*)(?:\s*[—–-]\s*(.+))?$/i.exec(s);
  if (m) {
    const head = localizeAlarmCode(t, m[1] ?? '');
    return m[2] ? `${head} — ${localizePhrase(t, m[2])}` : head;
  }
  return undefined;
}

/**
 * Plain-language explanations for alarms and notifications.
 *
 * Device codes (`GPS_SIGNAL_LOST`, `ADAS_HMW`, `INPUT_2_INACTIVE`, …) are
 * precise but cryptic for dispatchers. Every code is grouped into a topic with
 * two everyday sentences — what happened, and what to do about it — kept in
 * i18n under `alarms.explain.<topic>.{what,action}`. Unknown codes fall back to
 * the catalog type, then to a generic explanation, so nothing renders blank.
 */
import type { TFunction } from 'i18next';

import { mapAlarmType, resolveMeitrackAlarmCode, sourceEventAlarmCode } from '@/lib/alarm-copy';
import type { Alarm, AlarmSeverity, AlarmType } from '@/types/alarm.types';
import type { Notification } from '@/types/notification.types';

export type ExplainTopic =
  | 'sos'
  | 'overspeed'
  | 'speedOk'
  | 'geofenceEnter'
  | 'geofenceExit'
  | 'geofence'
  | 'offline'
  | 'online'
  | 'gpsLost'
  | 'gpsBack'
  | 'antennaCut'
  | 'jamming'
  | 'powerCut'
  | 'powerBack'
  | 'lowPower'
  | 'lowBattery'
  | 'tow'
  | 'crash'
  | 'harshDriving'
  | 'fatigue'
  | 'phone'
  | 'smoking'
  | 'distraction'
  | 'driverAbsent'
  | 'cameraBlocked'
  | 'tooClose'
  | 'laneDeparture'
  | 'blindSpot'
  | 'videoLoss'
  | 'videoBack'
  | 'storage'
  | 'ignitionOn'
  | 'ignitionOff'
  | 'idle'
  | 'parking'
  | 'fuelTheft'
  | 'fuelLow'
  | 'fuelFill'
  | 'temperature'
  | 'sleep'
  | 'reboot'
  | 'motion'
  | 'maintenance'
  | 'trip'
  | 'routine'
  | 'generic';

const EXACT: Readonly<Record<string, ExplainTopic>> = {
  SOS: 'sos',
  OVERSPEED: 'overspeed',
  SPEEDING: 'overspeed',
  SPEED_RECOVERY: 'speedOk',
  GEOFENCE_ENTER: 'geofenceEnter',
  GEOFENCE_EXIT: 'geofenceExit',
  DEVICE_OFFLINE: 'offline',
  OFFLINE: 'offline',
  DEVICE_ONLINE: 'online',
  GPS_SIGNAL_LOST: 'gpsLost',
  GPS_RECOVERED: 'gpsBack',
  GPS_ANTENNA_CUT: 'antennaCut',
  JAMMING: 'jamming',
  POWER_CUT: 'powerCut',
  POWER_OFF: 'powerCut',
  POWER_RESTORED: 'powerBack',
  LOW_POWER: 'lowPower',
  LOW_BATTERY: 'lowBattery',
  TOW: 'tow',
  ACCIDENT: 'crash',
  COLLISION: 'crash',
  ROLLOVER: 'crash',
  BRAKING: 'harshDriving',
  ACCELERATION: 'harshDriving',
  CORNERING: 'harshDriving',
  DRIVING_BEHAVIOR: 'harshDriving',
  ADAS_DMS_ALARM: 'distraction',
  ADAS_FRONT_VEHICLE_STARTED: 'generic',
  DMS_PHONE_CALL: 'phone',
  DMS_SMOKING: 'smoking',
  DMS_DRIVER_ABSENCE: 'driverAbsent',
  DMS_CAMERA_OCCLUSION: 'cameraBlocked',
  FACE_ID_ALARM: 'driverAbsent',
  INPUT_2_ACTIVE: 'ignitionOn',
  IGNITION_ON: 'ignitionOn',
  INPUT_2_INACTIVE: 'ignitionOff',
  IGNITION_OFF: 'ignitionOff',
  IDLE: 'idle',
  IDLE_OVERTIME: 'idle',
  PROLONGED_IDLE: 'idle',
  IDLE_RECOVERY: 'motion',
  PARKING: 'parking',
  FUEL_THEFT: 'fuelTheft',
  FUEL_LOW: 'fuelLow',
  FUEL_FILLING: 'fuelFill',
  FUEL_FULL: 'fuelFill',
  ENTER_SLEEP: 'sleep',
  EXIT_SLEEP: 'sleep',
  DEVICE_REBOOT: 'reboot',
  START_MOVING: 'motion',
  STOP_MOVING: 'motion',
  MAINTENANCE_NOTICE: 'maintenance',
  TRACK_BY_INTERVAL: 'routine',
  TRACK_BY_DISTANCE: 'routine',
  REPLY_CURRENT: 'routine',
};

const PREFIX: ReadonlyArray<readonly [string, ExplainTopic]> = [
  ['GEOFENCE', 'geofence'],
  ['FATIGUE', 'fatigue'],
  ['DMS_EYES', 'fatigue'],
  ['DMS_YAWN', 'fatigue'],
  ['DMS_DROWS', 'fatigue'],
  ['DMS_', 'distraction'],
  ['ADAS_LDW', 'laneDeparture'],
  ['ADAS_', 'tooClose'],
  ['BSD_', 'blindSpot'],
  ['VIDEO_LOSS', 'videoLoss'],
  ['VIDEO_RECOVERY', 'videoBack'],
  ['STORAGE', 'storage'],
  ['TEMPERATURE', 'temperature'],
  ['TRIP', 'trip'],
];

const BY_TYPE: Readonly<Partial<Record<AlarmType, ExplainTopic>>> = {
  sos: 'sos',
  overspeed: 'overspeed',
  geofence: 'geofence',
  offline: 'offline',
  'fuel-theft': 'fuelTheft',
  temperature: 'temperature',
  collision: 'crash',
  camera: 'videoLoss',
  dms: 'distraction',
  idle: 'idle',
  ignition: 'ignitionOn',
  battery: 'lowBattery',
  tow: 'tow',
  power: 'powerCut',
  jamming: 'jamming',
};

/** Resolve a device / rule code (or the catalog type) to an explanation topic. */
export function explainTopic(code?: string, type?: AlarmType | string): ExplainTopic {
  if (code) {
    const resolved = resolveMeitrackAlarmCode(code).replace(/-/g, '_');
    const exact = EXACT[resolved];
    if (exact) return exact;
    for (const [prefix, topic] of PREFIX) {
      if (resolved.startsWith(prefix)) return topic;
    }
    // `geofence_enter` style rule types.
    if (resolved.includes('GEOFENCE')) {
      return resolved.includes('EXIT') ? 'geofenceExit' : 'geofenceEnter';
    }
  }
  if (type) {
    const raw = String(type).toUpperCase().replace(/-/g, '_');
    if (EXACT[raw]) return EXACT[raw];
    const byType = BY_TYPE[mapAlarmType(String(type))];
    if (byType) return byType;
  }
  return 'generic';
}

export interface AlarmExplanation {
  topic: ExplainTopic;
  /** One everyday sentence: what happened. */
  what: string;
  /** One everyday sentence: what the operator should do. */
  action: string;
}

export function explainTopicCopy(t: TFunction, topic: ExplainTopic): AlarmExplanation {
  return {
    topic,
    what: t(`alarms.explain.${topic}.what`),
    action: t(`alarms.explain.${topic}.action`),
  };
}

export function explainAlarm(
  t: TFunction,
  alarm: Pick<Alarm, 'code' | 'type' | 'rawType' | 'message'>,
): AlarmExplanation {
  const code =
    alarm.code ||
    /^Device alarm ([A-Z][A-Z0-9_]*)/i.exec(alarm.message ?? '')?.[1] ||
    alarm.rawType;
  return explainTopicCopy(t, explainTopic(code, alarm.type));
}

export function explainNotification(
  t: TFunction,
  n: Pick<Notification, 'eventType' | 'metadata'>,
): AlarmExplanation {
  const metaCode = n.metadata?.alarmCode;
  const code =
    (typeof metaCode === 'string' && metaCode.trim()) ||
    sourceEventAlarmCode(n.eventType) ||
    n.eventType;
  return explainTopicCopy(t, explainTopic(code, n.eventType));
}

export type UrgencyLevel = 'critical' | 'major' | 'minor' | 'info';

/** Map alarm (critical/major/minor/info) and notification (urgent/high/normal/low) severities. */
export function urgencyLevel(severity: AlarmSeverity | string): UrgencyLevel {
  const s = String(severity).toLowerCase();
  if (s === 'critical' || s === 'urgent') return 'critical';
  if (s === 'major' || s === 'high') return 'major';
  if (s === 'minor' || s === 'normal') return 'minor';
  return 'info';
}

/** How urgent, in words (instead of a bare "critical / major" badge). */
export function urgencyText(t: TFunction, severity: AlarmSeverity | string): string {
  return t(`alarms.urgency.${urgencyLevel(severity)}`);
}

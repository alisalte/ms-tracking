/**
 * Meitrack event-code → canonical alarm mapping + outbound command codes
 * (Meitrack GPRS Protocol v1.6; aligned to the reference Traccar decodeAlarm
 * table). Shared by decode (inbound event mapping) and encode (outbound device
 * configuration) so the two never drift.
 */
import type { Alarm } from '../../../domain/device-message.js';

/**
 * Event codes carried in the `event` field of a tracking packet (AAA).
 * `000` = periodic track (no alarm); anything else is an event/alarm.
 *
 * Severity is our canonical mapping (06 §10.2):
 *   CRITICAL  — life-safety / theft (SOS, accident, power cut).
 *   WARNING   — operational degradation (low battery, overspeed, geofence, tow).
 *   INFO      — benign state change (power restored, geofence enter).
 *
 * This is a representative subset of the documented event table; codes outside
 * the map still decode (as a generic ALARM with the raw code as `source`) — the
 * map only upgrades the severity/code label.
 */
export const MEITRACK_EVENTS: Readonly<Record<number, Pick<Alarm, 'code' | 'severity'>>> = {
  1: { code: 'SOS', severity: 'CRITICAL' },
  17: { code: 'LOW_BATTERY', severity: 'WARNING' },
  18: { code: 'LOW_POWER', severity: 'WARNING' },
  19: { code: 'OVERSPEED', severity: 'WARNING' },
  20: { code: 'GEOFENCE_ENTER', severity: 'INFO' },
  21: { code: 'GEOFENCE_EXIT', severity: 'WARNING' },
  22: { code: 'POWER_RESTORED', severity: 'INFO' },
  23: { code: 'POWER_CUT', severity: 'CRITICAL' },
  24: { code: 'GPS_SIGNAL_LOST', severity: 'WARNING' },
  25: { code: 'GPS_RECOVERED', severity: 'INFO' },
  36: { code: 'TOW', severity: 'WARNING' },
  44: { code: 'JAMMING', severity: 'WARNING' },
  50: { code: 'TEMPERATURE_HIGH', severity: 'WARNING' },
  51: { code: 'TEMPERATURE_LOW', severity: 'WARNING' },
  52: { code: 'FUEL_FULL', severity: 'INFO' },
  53: { code: 'FUEL_LOW', severity: 'WARNING' },
  54: { code: 'FUEL_THEFT', severity: 'CRITICAL' },
  78: { code: 'ACCIDENT', severity: 'CRITICAL' },
  82: { code: 'FUEL_FILLING', severity: 'INFO' },
  90: { code: 'CORNERING', severity: 'WARNING' },
  91: { code: 'CORNERING', severity: 'WARNING' },
  114: { code: 'DRIVING_BEHAVIOR', severity: 'WARNING' },
  // 126 carries the DMS/ADAS detail in CCE parameter 0xFE31 — when present the
  // decoder upgrades this generic label via mapDmsAlarmType (see below).
  126: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  129: { code: 'BRAKING', severity: 'WARNING' },
  130: { code: 'ACCELERATION', severity: 'WARNING' },
  135: { code: 'FATIGUE_DRIVING', severity: 'WARNING' },
  136: { code: 'FATIGUE_TIME', severity: 'WARNING' },
  576: { code: 'VIDEO_LOSS_CH1', severity: 'WARNING' },
  577: { code: 'VIDEO_LOSS_CH2', severity: 'WARNING' },
  578: { code: 'VIDEO_LOSS_CH3', severity: 'WARNING' },
  579: { code: 'VIDEO_LOSS_CH4', severity: 'WARNING' },
  580: { code: 'VIDEO_LOSS_CH5', severity: 'WARNING' },
  581: { code: 'VIDEO_LOSS_CH6', severity: 'WARNING' },
  582: { code: 'VIDEO_LOSS_CH7', severity: 'WARNING' },
  583: { code: 'VIDEO_LOSS_CH8', severity: 'WARNING' },
  608: { code: 'STORAGE_FAILURE', severity: 'WARNING' },
  609: { code: 'STORAGE_FULL', severity: 'WARNING' },
  610: { code: 'VIDEO_RECOVERY_CH1', severity: 'INFO' },
  611: { code: 'VIDEO_RECOVERY_CH2', severity: 'INFO' },
  612: { code: 'VIDEO_RECOVERY_CH3', severity: 'INFO' },
  613: { code: 'VIDEO_RECOVERY_CH4', severity: 'INFO' },
};

/** Map an event code to a canonical Alarm; unknown codes get a generic label. */
export function mapMeitrackEvent(event: number): Alarm {
  const entry = MEITRACK_EVENTS[event];
  if (entry) {
    return { code: entry.code, source: String(event), severity: entry.severity };
  }
  return {
    code: `EVENT_${event}`,
    source: String(event),
    severity: 'INFO',
  };
}

// ── DMS / ADAS alarm detail (MDVR GPRS Protocol V2.0, CCE parameter 0xFE31) ──

/**
 * The 0xFE31 parameter of an event-126 CCE packet carries
 * <AlarmProtocol><AlarmType><PhotoName>; the tables below are the protocol's
 * two alarm-type vocabularies (0x01 legacy + 0x02 current).
 */
export interface DmsAlarm {
  readonly code: string;
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL';
  /** Human detail (English; surfaced in the alarm record + notification). */
  readonly detail: string;
}

const MEITRACK_DMS_TYPES_P1: Readonly<Record<number, Pick<DmsAlarm, 'code' | 'detail' | 'severity'>>> = {
  1: { code: 'DMS_EYES_CLOSED', detail: 'Eyes closed', severity: 'CRITICAL' },
  2: { code: 'DMS_YAWNING', detail: 'Yawning', severity: 'WARNING' },
  4: { code: 'DMS_HEAD_DOWN', detail: 'Head lowered', severity: 'WARNING' },
  5: { code: 'DMS_LOOKING_SIDE', detail: 'Looking left/right', severity: 'WARNING' },
  6: { code: 'DMS_DRIVER_ABSENCE', detail: 'Driver absence', severity: 'CRITICAL' },
  7: { code: 'DMS_PHONE_CALL', detail: 'Phone call', severity: 'WARNING' },
  8: { code: 'DMS_SMOKING', detail: 'Smoking', severity: 'WARNING' },
  9: { code: 'DMS_CAMERA_OCCLUSION', detail: 'Camera occlusion', severity: 'WARNING' },
  10: { code: 'ADAS_FCW', detail: 'Forward collision warning', severity: 'CRITICAL' },
  11: { code: 'ADAS_UFCW', detail: 'Urban forward collision warning', severity: 'WARNING' },
  12: { code: 'ADAS_LDW_LEFT', detail: 'Left lane departure', severity: 'WARNING' },
  13: { code: 'ADAS_LDW_RIGHT', detail: 'Right lane departure', severity: 'WARNING' },
  14: { code: 'ADAS_HMW', detail: 'Headway monitoring warning', severity: 'WARNING' },
  15: { code: 'ADAS_TTC1', detail: 'Time-to-collision 1', severity: 'CRITICAL' },
  16: { code: 'ADAS_TTC2', detail: 'Time-to-collision 2', severity: 'CRITICAL' },
};

const MEITRACK_DMS_TYPES_P2: Readonly<Record<number, Pick<DmsAlarm, 'code' | 'detail' | 'severity'>>> = {
  1: { code: 'DMS_LOOK_LEFT', detail: 'Looking left', severity: 'WARNING' },
  2: { code: 'DMS_LOOK_RIGHT', detail: 'Looking right', severity: 'WARNING' },
  3: { code: 'DMS_HEAD_UP', detail: 'Head raised', severity: 'WARNING' },
  4: { code: 'DMS_HEAD_DOWN', detail: 'Head lowered', severity: 'WARNING' },
  5: { code: 'DMS_DROWSINESS', detail: 'Drowsiness', severity: 'CRITICAL' },
  6: { code: 'DMS_YAWNING', detail: 'Yawning', severity: 'WARNING' },
  7: { code: 'DMS_PHONE_CALL', detail: 'Phone call', severity: 'WARNING' },
  8: { code: 'DMS_SMOKING', detail: 'Smoking', severity: 'WARNING' },
  9: { code: 'DMS_DRINKING', detail: 'Drinking', severity: 'WARNING' },
  10: { code: 'DMS_DRIVER_ABSENCE', detail: 'Driver absence', severity: 'CRITICAL' },
  11: { code: 'DMS_CAMERA_OCCLUSION', detail: 'Camera occlusion', severity: 'WARNING' },
  128: { code: 'ADAS_FCW', detail: 'Forward collision warning', severity: 'CRITICAL' },
  129: { code: 'ADAS_DISTANCE_DETECTION', detail: 'Distance detection', severity: 'WARNING' },
  130: { code: 'ADAS_LDW_LEFT', detail: 'Left lane departure', severity: 'WARNING' },
  131: { code: 'ADAS_LDW_RIGHT', detail: 'Right lane departure', severity: 'WARNING' },
  132: { code: 'ADAS_FRONT_VEHICLE_STARTED', detail: 'Front vehicle started', severity: 'INFO' },
};

/**
 * Map an event-126 0xFE31 alarm detail to a canonical DMS/ADAS alarm. Unknown
 * types keep the generic ADAS_DMS_ALARM code with the raw type in `detail`.
 */
export function mapDmsAlarmType(protocol: number, alarmType: number): DmsAlarm {
  const table = protocol === 1 ? MEITRACK_DMS_TYPES_P1 : MEITRACK_DMS_TYPES_P2;
  const entry = table[alarmType];
  if (entry) return { ...entry };
  return {
    code: 'ADAS_DMS_ALARM',
    detail: `Protocol ${protocol} alarm type ${alarmType}`,
    severity: 'WARNING',
  };
}

/**
 * Outbound device-configuration / command codes (server → device, Meitrack GPRS
 * Protocol v1.6 §"Command format"). These ride in the command field of an
 * `@@` frame built by `meitrack.encode`.
 */
export const MEITRACK_OUT_COMMAND = {
  /** Track on demand — device replies with one AAA tracking packet. */
  TRACK_ON_DEMAND: 'A10',
  /** Set / get the heartbeat (keep-alive) reporting interval, in seconds. */
  HEARTBEAT_INTERVAL: 'A11',
  /** Reboot the device. */
  REBOOT: 'F03',
} as const;

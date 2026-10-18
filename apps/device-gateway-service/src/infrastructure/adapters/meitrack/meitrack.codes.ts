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
  // Digital inputs (Meitrack §1.3) — codes 2–8 active, 9–16 inactive.
  2: { code: 'INPUT_2_ACTIVE', severity: 'WARNING' },
  3: { code: 'INPUT_3_ACTIVE', severity: 'WARNING' },
  4: { code: 'INPUT_4_ACTIVE', severity: 'WARNING' },
  5: { code: 'INPUT_5_ACTIVE', severity: 'WARNING' },
  6: { code: 'INPUT_6_ACTIVE', severity: 'WARNING' },
  7: { code: 'INPUT_7_ACTIVE', severity: 'WARNING' },
  8: { code: 'INPUT_8_ACTIVE', severity: 'WARNING' },
  9: { code: 'INPUT_1_INACTIVE', severity: 'INFO' },
  10: { code: 'INPUT_2_INACTIVE', severity: 'INFO' },
  11: { code: 'INPUT_3_INACTIVE', severity: 'INFO' },
  12: { code: 'INPUT_4_INACTIVE', severity: 'INFO' },
  13: { code: 'INPUT_5_INACTIVE', severity: 'INFO' },
  14: { code: 'INPUT_6_INACTIVE', severity: 'INFO' },
  15: { code: 'INPUT_7_INACTIVE', severity: 'INFO' },
  16: { code: 'INPUT_8_INACTIVE', severity: 'INFO' },
  17: { code: 'LOW_BATTERY', severity: 'WARNING' },
  18: { code: 'LOW_POWER', severity: 'WARNING' },
  19: { code: 'OVERSPEED', severity: 'WARNING' },
  20: { code: 'GEOFENCE_ENTER', severity: 'INFO' },
  21: { code: 'GEOFENCE_EXIT', severity: 'WARNING' },
  22: { code: 'POWER_RESTORED', severity: 'INFO' },
  23: { code: 'POWER_CUT', severity: 'CRITICAL' },
  24: { code: 'GPS_SIGNAL_LOST', severity: 'WARNING' },
  25: { code: 'GPS_RECOVERED', severity: 'INFO' },
  26: { code: 'ENTER_SLEEP', severity: 'INFO' },
  27: { code: 'EXIT_SLEEP', severity: 'INFO' },
  28: { code: 'GPS_ANTENNA_CUT', severity: 'WARNING' },
  29: { code: 'DEVICE_REBOOT', severity: 'INFO' },
  32: { code: 'CORNERING', severity: 'WARNING' },
  33: { code: 'TRACK_BY_DISTANCE', severity: 'INFO' },
  34: { code: 'REPLY_CURRENT', severity: 'INFO' },
  // Periodic track (AAA event 35) — devices emit this often; keep INFO so
  // operators see "interval track", not a mystery "Device event 35".
  35: { code: 'TRACK_BY_INTERVAL', severity: 'INFO' },
  36: { code: 'TOW', severity: 'WARNING' },
  40: { code: 'POWER_OFF', severity: 'WARNING' },
  41: { code: 'STOP_MOVING', severity: 'INFO' },
  42: { code: 'START_MOVING', severity: 'INFO' },
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
  // 126 is the protocol's DMS/ADAS event. This MD300 firmware does not use it:
  // the GPRS whitelist and live uploads use 655–663, and 0xFE31 (when present)
  // upgrades the generic label via mapDmsAlarmType.
  126: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  655: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  656: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  657: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  658: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  659: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  660: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  661: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  662: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
  663: { code: 'ADAS_DMS_ALARM', severity: 'WARNING' },
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
  614: { code: 'VIDEO_RECOVERY_CH5', severity: 'INFO' },
  615: { code: 'VIDEO_RECOVERY_CH6', severity: 'INFO' },
  616: { code: 'VIDEO_RECOVERY_CH7', severity: 'INFO' },
  617: { code: 'VIDEO_RECOVERY_CH8', severity: 'INFO' },
  647: { code: 'FACE_ID_ALARM', severity: 'WARNING' },
  // MEITRACK GPRS (CCE ID) Protocol V1.0 §1.2 — codes the older table lacked.
  37: { code: 'RFID', severity: 'INFO' },
  70: { code: 'INCOMING_CALL_REJECTED', severity: 'INFO' },
  71: { code: 'LOCATION_BY_CALL', severity: 'INFO' },
  72: { code: 'INCOMING_CALL_AUTO_ANSWERED', severity: 'INFO' },
  83: { code: 'ULTRASONIC_SENSOR_DROP', severity: 'WARNING' },
  87: { code: 'TPMS_ALARM', severity: 'WARNING' },
  94: { code: 'OUTPUT_1_ACTIVE', severity: 'INFO' },
  95: { code: 'OUTPUT_2_ACTIVE', severity: 'INFO' },
  96: { code: 'OUTPUT_3_ACTIVE', severity: 'INFO' },
  97: { code: 'OUTPUT_4_ACTIVE', severity: 'INFO' },
  98: { code: 'OUTPUT_5_ACTIVE', severity: 'INFO' },
  99: { code: 'OUTPUT_1_INACTIVE', severity: 'INFO' },
  100: { code: 'OUTPUT_2_INACTIVE', severity: 'INFO' },
  101: { code: 'OUTPUT_3_INACTIVE', severity: 'INFO' },
  102: { code: 'OUTPUT_4_INACTIVE', severity: 'INFO' },
  103: { code: 'OUTPUT_5_INACTIVE', severity: 'INFO' },
  117: { code: 'PEOPLE_COUNTER', severity: 'INFO' },
  133: { code: 'IDLE_OVERTIME', severity: 'WARNING' },
  134: { code: 'IDLE_RECOVERY', severity: 'INFO' },
  138: { code: 'SPEED_RECOVERY', severity: 'INFO' },
  139: { code: 'MAINTENANCE_NOTICE', severity: 'INFO' },
  159: { code: 'OUTPUT_6_ACTIVE', severity: 'INFO' },
  160: { code: 'OUTPUT_7_ACTIVE', severity: 'INFO' },
  161: { code: 'OUTPUT_8_ACTIVE', severity: 'INFO' },
  162: { code: 'OUTPUT_6_INACTIVE', severity: 'INFO' },
  163: { code: 'OUTPUT_7_INACTIVE', severity: 'INFO' },
  164: { code: 'OUTPUT_8_INACTIVE', severity: 'INFO' },
  165: { code: 'BLUETOOTH_PERIPHERAL_ALARM', severity: 'WARNING' },
  648: { code: 'ADAS_FCW', severity: 'CRITICAL' },
  650: { code: 'ADAS_PEDESTRIAN_CW', severity: 'CRITICAL' },
  651: { code: 'ADAS_LDW_LEFT', severity: 'WARNING' },
  652: { code: 'ADAS_LDW_RIGHT', severity: 'WARNING' },
  653: { code: 'ADAS_HMW', severity: 'WARNING' },
  669: { code: 'BSD_FRONT', severity: 'WARNING' },
  670: { code: 'BSD_BEHIND', severity: 'WARNING' },
  671: { code: 'BSD_LEFT', severity: 'WARNING' },
  672: { code: 'BSD_RIGHT', severity: 'WARNING' },
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

const MEITRACK_DMS_TYPES_P1: Readonly<
  Record<number, Pick<DmsAlarm, 'code' | 'detail' | 'severity'>>
> = {
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

const MEITRACK_DMS_TYPES_P2: Readonly<
  Record<number, Pick<DmsAlarm, 'code' | 'detail' | 'severity'>>
> = {
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
  // This MD300 firmware extends protocol 0x02 past the V2.0 table. Live
  // uploads used type 12 with photo ddw.jpg and type 13 with photo irblk.jpg.
  12: { code: 'DMS_DISTRACTION', detail: 'Distracted driving', severity: 'WARNING' },
  13: { code: 'DMS_CAMERA_OCCLUSION', detail: 'IR camera blocked', severity: 'WARNING' },
  128: { code: 'ADAS_FCW', detail: 'Forward collision warning', severity: 'CRITICAL' },
  129: { code: 'ADAS_DISTANCE_DETECTION', detail: 'Distance detection', severity: 'WARNING' },
  130: { code: 'ADAS_LDW_LEFT', detail: 'Left lane departure', severity: 'WARNING' },
  131: { code: 'ADAS_LDW_RIGHT', detail: 'Right lane departure', severity: 'WARNING' },
  132: { code: 'ADAS_FRONT_VEHICLE_STARTED', detail: 'Front vehicle started', severity: 'INFO' },
};

/** Photo basename this firmware stores when the numeric type is outside the table. */
function dmsFromPhotoName(photoName: string | null | undefined): DmsAlarm | null {
  const base = (photoName ?? '').split(/[/\\]/).pop()?.toLowerCase() ?? '';
  if (!base) return null;
  if (base.startsWith('ddw') || base.includes('distract')) {
    return { code: 'DMS_DISTRACTION', detail: 'Distracted driving', severity: 'WARNING' };
  }
  if (base.startsWith('irblk') || base.includes('occlusion')) {
    return { code: 'DMS_CAMERA_OCCLUSION', detail: 'IR camera blocked', severity: 'WARNING' };
  }
  if (base.includes('phone') || base.startsWith('call')) {
    return { code: 'DMS_PHONE_CALL', detail: 'Phone call', severity: 'WARNING' };
  }
  if (base.startsWith('smok')) {
    return { code: 'DMS_SMOKING', detail: 'Smoking', severity: 'WARNING' };
  }
  if (base.startsWith('yawn')) {
    return { code: 'DMS_YAWNING', detail: 'Yawning', severity: 'WARNING' };
  }
  if (base.startsWith('fatigue') || base.includes('drowsy')) {
    return { code: 'DMS_DROWSINESS', detail: 'Drowsiness', severity: 'CRITICAL' };
  }
  return null;
}

/**
 * Map a 0xFE31 alarm detail to a canonical DMS/ADAS alarm. Unknown types fall
 * back to the photo name (`ddw.jpg`, `irblk.jpg`) and otherwise keep
 * ADAS_DMS_ALARM with the raw type in `detail`.
 */
export function mapDmsAlarmType(
  protocol: number,
  alarmType: number,
  photoName?: string | null,
): DmsAlarm {
  const table =
    protocol === 1 ? MEITRACK_DMS_TYPES_P1 : protocol === 2 ? MEITRACK_DMS_TYPES_P2 : null;
  const entry = table?.[alarmType];
  if (entry) return { ...entry };
  const fromPhoto = dmsFromPhotoName(photoName);
  if (fromPhoto) return fromPhoto;
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

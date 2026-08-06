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
  36: { code: 'TOW', severity: 'WARNING' },
  44: { code: 'JAMMING', severity: 'WARNING' },
  78: { code: 'ACCIDENT', severity: 'CRITICAL' },
  90: { code: 'CORNERING', severity: 'WARNING' },
  91: { code: 'CORNERING', severity: 'WARNING' },
  129: { code: 'BRAKING', severity: 'WARNING' },
  130: { code: 'ACCELERATION', severity: 'WARNING' },
  135: { code: 'FATIGUE_DRIVING', severity: 'WARNING' },
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

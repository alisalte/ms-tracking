/**
 * GT06 / Concox alarm-type → canonical alarm mapping
 * (Concox GT06 Communication Protocol v1.8.1; GT06N alarm table).
 *
 * The standard Concox `0x05` alarm packet prepends a single terminal-info byte
 * whose value identifies the alarm that fired, followed by the same GPS block as
 * a `0x10` location packet. This table maps those type bytes to the canonical
 * Alarm shape (06 §10.2). A representative subset of the documented table is
 * encoded; unmapped types still decode with a generic label so no alarm is lost.
 *
 * NOTE: this is the standard Concox `0x05` family. Traccar's `MSG_ALARM = 0x95`
 * is a *different*, JC100-specific packet with its own event table — not handled
 * here (a later-sprint extension point for that device family).
 */
import type { Alarm } from '../../../domain/device-message.js';

/** Standard GT06N / Concox `0x05` alarm-type byte → {code, severity}. */
export const GT06_ALARM_TYPE: Readonly<
  Record<number, { code: string; severity: Alarm['severity'] }>
> = {
  1: { code: 'SOS', severity: 'CRITICAL' }, // 一键SOS
  2: { code: 'POWER_CUT', severity: 'CRITICAL' }, // 断电报警 (external power cut)
  3: { code: 'SHOCK', severity: 'WARNING' }, // 震动报警 (vibration/shock)
  4: { code: 'GEOFENCE_ENTER', severity: 'INFO' }, // 进围栏
  5: { code: 'GEOFENCE_EXIT', severity: 'WARNING' }, // 出围栏
  6: { code: 'OVERSPEED', severity: 'WARNING' }, // 超速报警
  9: { code: 'DISPLACEMENT', severity: 'WARNING' }, // 位移报警 (movement when parked)
  10: { code: 'LOW_BATTERY', severity: 'WARNING' }, // 低电量报警
  11: { code: 'OUTGUARD', severity: 'WARNING' }, // disarm-out-of-area / out-of-fence guard
  12: { code: 'DOOR_OPEN', severity: 'INFO' }, // 车门打开 (some GT06N variants)
};

/**
 * Map a GT06 `0x05` alarm-type byte to a canonical Alarm; unknown types get a
 * generic label so the event is still surfaced for triage.
 */
export function mapGt06Alarm(type: number): Alarm {
  const entry = GT06_ALARM_TYPE[type];
  if (entry) {
    return {
      code: entry.code,
      source: `0x${type.toString(16).padStart(2, '0')}`,
      severity: entry.severity,
    };
  }
  return {
    code: `GT06_ALARM_0x${type.toString(16).padStart(2, '0')}`,
    source: `0x${type.toString(16).padStart(2, '0')}`,
    severity: 'INFO',
  };
}

/**
 * Alarm type + severity + status type definitions (12_Alarm_Engine.md §2, §6).
 *
 * The rule type union is extensible — new alarm types are added here and a
 * matching evaluator is registered, without rewriting the engine.
 */

/** Alarm rule types. Add new types here; the evaluator registry maps each to a
 *  concrete evaluator. */
export const ALARM_RULE_TYPES = [
  // Vehicle
  'overspeed',
  'ignition_on',
  'ignition_off',
  'prolonged_idle',
  'parking',
  'device_offline',
  'low_battery',
  // Geospatial
  'geofence_enter',
  'geofence_exit',
  'geofence_dwell',
  // Trip
  'trip_started',
  'trip_ended',
  'excessive_trip_duration',
  'excessive_stop_duration',
] as const;
export type AlarmRuleType = (typeof ALARM_RULE_TYPES)[number];

/** Five-level severity matrix (12_Alarm_Engine.md §2.11). Ordered by urgency. */
export const ALARM_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type AlarmSeverity = (typeof ALARM_SEVERITIES)[number];

/** Severity rank for comparison (higher = more urgent). */
export const severityRank: Record<AlarmSeverity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/** Alarm lifecycle status (12_Alarm_Engine.md §6.2). */
export const ALARM_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type AlarmStatus = (typeof ALARM_STATUSES)[number];

/** Repeat/dedup policy controlling alarm storms. */
export const REPEAT_POLICIES = ['ALWAYS', 'ONCE', 'COOLDOWN'] as const;
export type RepeatPolicy = (typeof REPEAT_POLICIES)[number];

/** Check whether a status transition is legal. */
export function isValidTransition(from: AlarmStatus, to: AlarmStatus): boolean {
  if (from === to) return false;
  // OPEN → ACKNOWLEDGED → RESOLVED; OPEN → RESOLVED (direct resolve) also valid.
  if (from === 'OPEN' && (to === 'ACKNOWLEDGED' || to === 'RESOLVED')) return true;
  if (from === 'ACKNOWLEDGED' && to === 'RESOLVED') return true;
  return false;
}

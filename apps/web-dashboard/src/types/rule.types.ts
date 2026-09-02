/**
 * Alarm-rule types — UI camelCase mapped from notification-service AlarmRule.
 */
export type AlarmRuleType =
  | 'overspeed'
  | 'ignition_on'
  | 'ignition_off'
  | 'prolonged_idle'
  | 'parking'
  | 'device_offline'
  | 'geofence_enter'
  | 'geofence_exit'
  | 'geofence_dwell'
  | 'trip_started'
  | 'trip_ended'
  | 'excessive_trip_duration'
  | 'excessive_stop_duration';

export type AlarmRuleSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RepeatPolicy = 'ALWAYS' | 'ONCE' | 'COOLDOWN';

export const ALARM_RULE_TYPES: readonly AlarmRuleType[] = [
  'overspeed',
  'ignition_on',
  'ignition_off',
  'prolonged_idle',
  'parking',
  'device_offline',
  'geofence_enter',
  'geofence_exit',
  'geofence_dwell',
  'trip_started',
  'trip_ended',
  'excessive_trip_duration',
  'excessive_stop_duration',
];

export const ALARM_RULE_SEVERITIES: readonly AlarmRuleSeverity[] = [
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
];

export const REPEAT_POLICIES: readonly RepeatPolicy[] = ['ALWAYS', 'ONCE', 'COOLDOWN'];

export interface AlarmRule {
  id: string;
  tenantId: string;
  name: string;
  type: AlarmRuleType;
  severity: AlarmRuleSeverity;
  enabled: boolean;
  entityType: string;
  entityId: string | null;
  conditions: Record<string, unknown>;
  cooldownSec: number;
  dedupWindowSec: number;
  repeatPolicy: RepeatPolicy;
  version: number;
}

export interface CreateAlarmRulePayload {
  name: string;
  type: AlarmRuleType;
  severity: AlarmRuleSeverity;
  entityId?: string | null;
  conditions: Record<string, unknown>;
  cooldownSec: number;
  dedupWindowSec: number;
  repeatPolicy: RepeatPolicy;
}

export type UpdateAlarmRulePayload = Partial<
  Omit<CreateAlarmRulePayload, 'type'>
>;

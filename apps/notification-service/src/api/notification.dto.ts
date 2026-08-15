/**
 * Notification-service request body schemas (Zod).
 * tenant_id is intentionally absent from every schema (INV-I02: from JWT).
 */
import { z } from 'zod';

const ALARM_TYPES = [
  'overspeed',
  'ignition_on',
  'ignition_off',
  'prolonged_idle',
  'parking',
  'device_offline',
  'low_battery',
  'geofence_enter',
  'geofence_exit',
  'geofence_dwell',
  'trip_started',
  'trip_ended',
  'excessive_trip_duration',
  'excessive_stop_duration',
] as const;

const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const REPEAT_POLICIES = ['ALWAYS', 'ONCE', 'COOLDOWN'] as const;

export const createRuleSchema = z.object({
  name: z.string().min(1).max(256),
  type: z.enum(ALARM_TYPES),
  severity: z.enum(SEVERITIES),
  entity_id: z.string().uuid().nullable().optional(),
  conditions: z.record(z.unknown()).default({}),
  cooldown_sec: z.number().int().min(0).default(300),
  dedup_window_sec: z.number().int().min(0).default(600),
  repeat_policy: z.enum(REPEAT_POLICIES).default('COOLDOWN'),
});
export type CreateRuleDto = z.infer<typeof createRuleSchema>;

export const updateRuleSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  severity: z.enum(SEVERITIES).optional(),
  conditions: z.record(z.unknown()).optional(),
  cooldown_sec: z.number().int().min(0).optional(),
  dedup_window_sec: z.number().int().min(0).optional(),
  repeat_policy: z.enum(REPEAT_POLICIES).optional(),
});
export type UpdateRuleDto = z.infer<typeof updateRuleSchema>;

export const resolveAlarmSchema = z.object({
  reason: z.string().max(512).optional(),
});
export type ResolveAlarmDto = z.infer<typeof resolveAlarmSchema>;

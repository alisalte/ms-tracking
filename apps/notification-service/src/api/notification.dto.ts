/**
 * Notification-service request body schemas (Zod).
 * tenant_id is intentionally absent from every schema (INV-I02: from JWT).
 *
 * Sprint G Part 28: per-type condition validation. A rule configuration that
 * the engine cannot evaluate (missing threshold, non-uuid geofenceId, negative
 * duration…) is rejected at the API boundary — no invalid rule can be stored.
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

const positiveInt = (min: number) => z.number().int().min(min);

/** Per-type condition schemas — only fields the engine actually evaluates. */
export const CONDITION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  overspeed: z
    .object({
      thresholdKmh: positiveInt(1),
      gracePeriodSec: positiveInt(0).optional(),
    })
    .strict(),
  ignition_on: z.object({}).strict(),
  ignition_off: z.object({}).strict(),
  prolonged_idle: z
    .object({
      minDurationSec: positiveInt(1),
    })
    .strict(),
  parking: z
    .object({
      minDurationSec: positiveInt(1),
    })
    .strict(),
  device_offline: z
    .object({
      minOfflineSec: positiveInt(1).optional(),
    })
    .strict(),
  geofence_enter: z
    .object({
      geofenceId: z.string().uuid(),
    })
    .strict(),
  geofence_exit: z
    .object({
      geofenceId: z.string().uuid(),
    })
    .strict(),
  // geofence_dwell: dwell evaluation is DEFERRED (Sprint G) — no dwell-state
  // tracking exists yet, so rules of this type are rejected rather than
  // stored-but-never-firing.
  trip_started: z.object({}).strict(),
  trip_ended: z.object({}).strict(),
  excessive_trip_duration: z
    .object({
      maxDurationSec: positiveInt(1),
    })
    .strict(),
  excessive_stop_duration: z
    .object({
      maxStopDurationSec: positiveInt(1),
    })
    .strict(),
  // low_battery: no battery telemetry field exists in the current telemetry
  // domain — rules of this type are rejected (Sprint G Part 3: never fabricate).
};

export function conditionsForType(
  type: (typeof ALARM_TYPES)[number],
  conditions: unknown,
): unknown {
  const schema = CONDITION_SCHEMAS[type];
  if (schema) return schema.parse(conditions);
  // No evaluator / no schema → reject: only rules the engine can evaluate.
  throw new Error(`Rule type '${type}' is not supported by the alarm engine yet`);
}

const createRuleBase = {
  name: z.string().min(1).max(256),
  type: z.enum(ALARM_TYPES),
  severity: z.enum(SEVERITIES),
  entity_id: z.string().uuid().nullable().optional(),
  cooldown_sec: positiveInt(0).default(300),
  dedup_window_sec: positiveInt(0).default(600),
  repeat_policy: z.enum(REPEAT_POLICIES).default('COOLDOWN'),
};

export const createRuleSchema = z
  .object({
    ...createRuleBase,
    conditions: z.record(z.unknown()).default({}),
  })
  .superRefine((val, ctx) => {
    try {
      conditionsForType(val.type, val.conditions);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conditions'],
        message: `invalid conditions for type '${val.type}': ${(err as Error).message}`,
      });
    }
  });
export type CreateRuleDto = z.infer<typeof createRuleSchema>;

export const updateRuleSchema = z
  .object({
    name: z.string().min(1).max(256).optional(),
    severity: z.enum(SEVERITIES).optional(),
    conditions: z.record(z.unknown()).optional(),
    cooldown_sec: positiveInt(0).optional(),
    dedup_window_sec: positiveInt(0).optional(),
    repeat_policy: z.enum(REPEAT_POLICIES).optional(),
  })
  .refine((val) => Object.keys(val).length > 0, { message: 'at least one field required' });
export type UpdateRuleDto = z.infer<typeof updateRuleSchema>;

export const resolveAlarmSchema = z.object({
  reason: z.string().max(512).optional(),
});
export type ResolveAlarmDto = z.infer<typeof resolveAlarmSchema>;

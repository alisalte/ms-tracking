/**
 * AlarmRule — the rule definition aggregate (12_Alarm_Engine.md §3).
 *
 * A rule says WHAT to detect (type + conditions), for WHOM (entity), with what
 * severity, and how to deduplicate. It does NOT detect or persist — that's the
 * evaluator's and occurrence repository's job.
 *
 * The `conditions` JSONB holds type-specific threshold params:
 *   overspeed:              { thresholdKmh: number }
 *   prolonged_idle:         { minDurationSec: number }
 *   parking:                { minDurationSec: number }
 *   device_offline:         { minOfflineSec: number }
 *   geofence_enter/exit:    { geofenceId: string }
 *   geofence_dwell:         { geofenceId: string, dwellSec: number }
 *   excessive_trip_duration:{ maxDurationSec: number }
 *   excessive_stop_duration:{ maxStopDurationSec: number }
 *   ignition_on/off/trip_started/trip_ended: {} (no params — always fires on the event)
 */
import { randomUUID } from 'node:crypto';
import { IllegalStatusTransitionError } from './alarm-errors.js';
import type { AlarmRuleType, AlarmSeverity, RepeatPolicy } from './alarm-types.js';

export interface AlarmRuleProps {
  readonly tenantId: string;
  name: string;
  type: AlarmRuleType;
  severity: AlarmSeverity;
  enabled: boolean;
  entityType: string;
  /** null = applies to all vehicles in the tenant. */
  entityId: string | null;
  conditions: Record<string, unknown>;
  cooldownSec: number;
  dedupWindowSec: number;
  repeatPolicy: RepeatPolicy;
}

export class AlarmRule {
  public readonly tenantId: string;
  public name: string;
  public readonly type: AlarmRuleType;
  public severity: AlarmSeverity;
  public enabled: boolean;
  public entityType: string;
  public entityId: string | null;
  public conditions: Record<string, unknown>;
  public cooldownSec: number;
  public dedupWindowSec: number;
  public repeatPolicy: RepeatPolicy;
  public version: number;

  private constructor(id: string, version: number, props: AlarmRuleProps) {
    this.id = id;
    this.tenantId = props.tenantId;
    this.name = props.name;
    this.type = props.type;
    this.severity = props.severity;
    this.enabled = props.enabled;
    this.entityType = props.entityType;
    this.entityId = props.entityId;
    this.conditions = props.conditions;
    this.cooldownSec = props.cooldownSec;
    this.dedupWindowSec = props.dedupWindowSec;
    this.repeatPolicy = props.repeatPolicy;
    this.version = version;
  }

  public readonly id: string;

  /** Factory: create a new rule. */
  public static create(id: string | undefined, props: AlarmRuleProps): AlarmRule {
    return new AlarmRule(id ?? randomUUID(), 1, props);
  }

  /** Factory: rehydrate from persistence. */
  public static rehydrate(id: string, version: number, props: AlarmRuleProps): AlarmRule {
    return new AlarmRule(id, version, props);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** Does this rule apply to the given vehicle? (entityId null = all vehicles) */
  public appliesTo(vehicleId: string): boolean {
    if (!this.enabled) return false;
    if (this.entityId === null) return true;
    return this.entityId === vehicleId;
  }

  /** Read a numeric condition param with a fallback default. */
  public conditionNum(key: string, fallback: number): number {
    const v = this.conditions[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  public disable(): void {
    this.enabled = false;
  }

  public enable(): void {
    this.enabled = true;
  }
}

export { IllegalStatusTransitionError };

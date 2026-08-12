/**
 * AlarmEvent — the internal detection result produced by a rule evaluator
 * BEFORE dedup/occurrence creation. This is the boundary between detection
 * (does this signal match this rule?) and occurrence (should we persist + notify?).
 *
 * The alarm evaluator service receives AlarmEvents from evaluators, runs them
 * through the dedup manager, and only creates an AlarmOccurrence if the dedup
 * manager allows it.
 */
import type { AlarmRuleType, AlarmSeverity } from './alarm-types.js';

export interface AlarmEvent {
  readonly ruleId: string;
  readonly type: AlarmRuleType;
  readonly tenantId: string;
  readonly vehicleId: string | null;
  readonly severity: AlarmSeverity;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly message: string;
  /** The triggering signal/event data for forensic context. */
  readonly sourceEvent: Record<string, unknown>;
  readonly detectedAt: Date;
}

/**
 * Rule evaluator interface — each alarm type has a concrete evaluator that
 * checks whether an incoming signal matches the rule's conditions.
 *
 * The evaluator returns an AlarmEvent (detection result) or null (no match).
 * The alarm evaluator service then runs dedup + occurrence creation.
 *
 * New alarm types: add a type to AlarmRuleType, create an evaluator, and
 * register it in the evaluator registry — the engine itself doesn't change.
 */
import type { AlarmEvent } from '../../domain/alarm-event.js';
import type { AlarmRule } from '../../domain/alarm-rule.js';

/** A signal (position/status/trip/idle/parking) consumed from Kafka. */
export type InputSignal =
  | {
      kind: 'position';
      tenantId: string;
      vehicleId: string;
      lat: number;
      lng: number;
      speedKph: number;
      headingDeg: number;
      capturedAt: string;
      ignitionOn: boolean | null;
    }
  | { kind: 'device_status'; tenantId: string; deviceId: string; state: string; lastSeenAt: string }
  | {
      kind: 'trip';
      tenantId: string;
      vehicleId: string;
      type: string;
      durationSec: number;
      distanceKm: number;
      startedAt: string;
      endedAt: string;
    };

export interface RuleEvaluator {
  /** Evaluate the signal against the rule. Return AlarmEvent if matched, null otherwise. */
  evaluate(signal: InputSignal, rule: AlarmRule): AlarmEvent | null;
}

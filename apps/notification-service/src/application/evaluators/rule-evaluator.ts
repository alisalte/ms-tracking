/**
 * Rule evaluator interface — each alarm type has a concrete evaluator that
 * checks whether an incoming signal matches the rule's conditions.
 *
 * The evaluator returns an AlarmEvent (detection result) or null (no match).
 * The alarm evaluator service then runs dedup + occurrence creation.
 *
 * New alarm types: add a type to AlarmRuleType, create an evaluator, and
 * register it in the evaluator registry — the engine itself doesn't change.
 *
 * Sprint G: `idle` and `parking` signal kinds arrive from the gps-engine
 * FleetEvent topic (tracking.event.v1); `sourceEventId` is the triggering
 * position's messageId — the deterministic idempotency key.
 */
import type { AlarmEvent } from '../../domain/alarm-event.js';
import type { AlarmRule } from '../../domain/alarm-rule.js';

/** A signal (position/status/trip/idle/parking) consumed from Kafka. */
export type InputSignal =
  | {
      kind: 'position';
      tenantId: string;
      vehicleId: string;
      deviceId: string | null;
      lat: number;
      lng: number;
      speedKph: number;
      headingDeg: number;
      capturedAt: string;
      ignitionOn: boolean | null;
      sourceEventId: string | null;
    }
  | {
      kind: 'device_status';
      tenantId: string;
      vehicleId: string;
      deviceId: string;
      state: string;
      lastSeenAt: string;
      sourceEventId: string | null;
    }
  | {
      kind: 'trip';
      tenantId: string;
      vehicleId: string;
      type: string;
      durationSec: number;
      distanceKm: number;
      startedAt: string;
      endedAt: string;
      sourceEventId: string | null;
    }
  | {
      kind: 'idle';
      tenantId: string;
      vehicleId: string;
      type: 'idle.started' | 'idle.ended' | 'idle.alert';
      startedAt: string | null;
      endedAt: string;
      durationSec: number;
      sourceEventId: string | null;
    }
  | {
      kind: 'parking';
      tenantId: string;
      vehicleId: string;
      type: 'parking.started' | 'parking.ended' | 'parking.tamper';
      startedAt: string | null;
      endedAt: string;
      durationSec: number;
      sourceEventId: string | null;
    };

export interface RuleEvaluator {
  /** Evaluate the signal against the rule. Return AlarmEvent if matched, null otherwise. */
  evaluate(signal: InputSignal, rule: AlarmRule): AlarmEvent | null;
}

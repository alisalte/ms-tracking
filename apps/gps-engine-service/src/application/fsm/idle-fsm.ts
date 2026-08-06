/**
 * Idle FSM — per-vehicle idle detection (07 §5.4; GPSEngine.md §5).
 *
 * Idle = stationary (speed ≤ idle-speed) WITH ignition ON, sustained ≥
 * idle-threshold-s. PTO engaged suppresses idle (legitimate equipment use).
 * An alert fires once per idle window at idle-alert-threshold-s.
 *
 * States: ACTIVE (engine on, moving or not-yet-idle) ↔ IDLE (idle window open).
 *
 * Pure: takes state + position + thresholds, returns new state + events.
 */
import type { PositionEvent } from '../../domain/position-event.js';
import type {
  IdleEvent,
  IdleFsmState,
  TripEngineThresholds,
} from '../../domain/trip/trip-types.js';
import { INITIAL_IDLE_FSM } from '../../domain/trip/trip-types.js';

export interface IdleFsmInput {
  readonly state: IdleFsmState;
  readonly position: PositionEvent;
  readonly thresholds: TripEngineThresholds;
}

export interface IdleFsmOutput {
  readonly state: IdleFsmState;
  readonly events: readonly IdleEvent[];
}

/** Advance the idle FSM by one position. Pure. */
export function advanceIdleFsm(input: IdleFsmInput): IdleFsmOutput {
  const { state, position, thresholds } = input;
  const events: IdleEvent[] = [];
  const ignitionOn = position.ignitionOn === true;
  // PTO engaged suppresses idle (07 §5.4). We read it from telemetry if present.
  const ptoEngaged = Boolean((position as PositionEvent & { ptoEngaged?: boolean }).ptoEngaged);
  const isStationary = position.speedKph <= thresholds.idleSpeedKmh;
  const idleCondition = ignitionOn && isStationary && !ptoEngaged;

  switch (state.state) {
    case 'ACTIVE': {
      if (!idleCondition) {
        // Not idle (moving, ign off, or PTO) — cancel any candidate.
        if (state.idleStartAt) {
          return { state: { ...INITIAL_IDLE_FSM }, events: [] };
        }
        return { state, events: [] };
      }
      // Idle condition met.
      if (!state.idleStartAt) {
        // Open the candidate window.
        return {
          state: { ...state, idleStartAt: position.capturedAt },
          events: [],
        };
      }
      // Candidate already open — check if threshold reached to transition to IDLE.
      const idleSec = (position.capturedAt.getTime() - state.idleStartAt.getTime()) / 1000;
      if (idleSec >= thresholds.idleThresholdS) {
        events.push({
          type: 'idle.started',
          vehicleId: position.vehicleId,
          tenantId: position.tenantId,
          startedAt: state.idleStartAt,
          endedAt: position.capturedAt,
          durationSec: idleSec,
        });
        return { state: { ...state, state: 'IDLE' }, events };
      }
      // Below threshold — keep the candidate.
      return { state, events: [] };
    }

    case 'IDLE': {
      if (!idleCondition) {
        // Movement resumed, ignition off, or PTO engaged → close the idle window.
        const durationSec = state.idleStartAt
          ? (position.capturedAt.getTime() - state.idleStartAt.getTime()) / 1000
          : 0;
        events.push({
          type: 'idle.ended',
          vehicleId: position.vehicleId,
          tenantId: position.tenantId,
          startedAt: state.idleStartAt,
          endedAt: position.capturedAt,
          durationSec,
        });
        return { state: { ...INITIAL_IDLE_FSM }, events };
      }
      // Still idle — check the alert threshold (fires once per window).
      const idleSec = state.idleStartAt
        ? (position.capturedAt.getTime() - state.idleStartAt.getTime()) / 1000
        : 0;
      if (!state.alerted && idleSec >= thresholds.idleAlertThresholdS) {
        events.push({
          type: 'idle.alert',
          vehicleId: position.vehicleId,
          tenantId: position.tenantId,
          startedAt: state.idleStartAt,
          endedAt: position.capturedAt,
          durationSec: idleSec,
        });
        return { state: { ...state, alerted: true }, events };
      }
      return { state, events: [] };
    }

    default:
      return { state, events: [] };
  }
}

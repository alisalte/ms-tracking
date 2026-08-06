/**
 * Trip FSM — per-vehicle trip segmentation (07 §5.2; GPSEngine.md §4).
 *
 * States: STOP → MOVING → PENDING_STOP → CLOSED.
 *
 *   STOP        → MOVING: sustained movement (speed ≥ start-speed for ≥ start-duration).
 *   MOVING      → MOVING: movement continues (reset stop-pending timer).
 *   MOVING      → PENDING_STOP: speed ≤ stop-speed.
 *   PENDING_STOP→ MOVING: movement resumes before min-stop-duration (a traffic-light pause).
 *   PENDING_STOP→ CLOSED: stationary ≥ min-stop-duration OR ignition-off.
 *   CLOSED      → STOP: emit trip.ended (if ≥ min-trip-distance) else discard micro-trip.
 *
 * Gap handling: a time gap ≥ max-gap-in-trip-s between consecutive positions
 * breaks the current trip (forces a close).
 *
 * Pure: takes the current FSM state + a position + the previous position + the
 * filtered distance step, returns the new state + any boundary/stop events. The
 * caller (TripEngine) is responsible for persisting the state and emitting events.
 */
import type { PositionEvent } from '../../domain/position-event.js';
import type {
  StopDetectedEvent,
  TripBoundaryEvent,
  TripEngineThresholds,
  TripFsmState,
} from '../../domain/trip/trip-types.js';
import { INITIAL_TRIP_FSM } from '../../domain/trip/trip-types.js';

export interface TripFsmInput {
  readonly state: TripFsmState;
  readonly position: PositionEvent;
  /** Previous position (null on first sighting). */
  readonly prevPosition: PositionEvent | null;
  /** Filtered distance step (meters) from prev → current. */
  readonly distanceStepM: number;
  readonly thresholds: TripEngineThresholds;
}

export interface TripFsmOutput {
  readonly state: TripFsmState;
  readonly events: readonly (TripBoundaryEvent | StopDetectedEvent)[];
}

/** Advance the trip FSM by one position. Pure. */
export function advanceTripFsm(input: TripFsmInput): TripFsmOutput {
  const { state, position, prevPosition, distanceStepM, thresholds } = input;
  const events: (TripBoundaryEvent | StopDetectedEvent)[] = [];
  const speed = position.speedKph;
  const moving = speed >= thresholds.tripStartSpeedKmh;
  const slow = speed <= thresholds.tripStopSpeedKmh;

  // Gap detection: a long gap breaks the current trip.
  const gapSec = prevPosition
    ? (position.capturedAt.getTime() - prevPosition.capturedAt.getTime()) / 1000
    : 0;
  const gapBreaks = gapSec >= thresholds.maxGapInTripS;

  switch (state.state) {
    case 'STOP': {
      if (moving) {
        // Start tracking sustained movement. For Sprint 8 we open the trip
        // candidate immediately on the first moving position (the spec's full
        // start-duration debounce is a refinement; the FSM state records
        // tripStartAt so the debounce can be added without restructuring).
        return {
          state: {
            ...state,
            state: 'MOVING',
            tripStartAt: position.capturedAt,
            lastMovingAt: position.capturedAt,
            startLat: position.latitude,
            startLng: position.longitude,
            distanceM: 0,
            maxSpeedKmh: speed,
            stopCount: 0,
          },
          events: [
            {
              type: 'trip.started',
              vehicleId: position.vehicleId,
              tenantId: position.tenantId,
              startLat: position.latitude,
              startLng: position.longitude,
              endLat: position.latitude,
              endLng: position.longitude,
              startedAt: position.capturedAt,
              endedAt: position.capturedAt,
              distanceKm: 0,
              durationSec: 0,
              maxSpeedKmh: speed,
              stopCount: 0,
            },
          ],
        };
      }
      return { state, events: [] };
    }

    case 'MOVING': {
      const newDistance = state.distanceM + distanceStepM;
      const newMaxSpeed = Math.max(state.maxSpeedKmh, speed);
      if (gapBreaks) {
        // Gap too long → close the trip (with the accumulated distance).
        return closeTrip(
          { ...state, distanceM: newDistance, maxSpeedKmh: newMaxSpeed },
          position,
          thresholds,
          events,
        );
      }
      if (slow) {
        // Check if the dwell since last movement already exceeds min-stop-duration
        // (the gap between the last moving fix and this slow fix is large enough
        // to close the trip immediately, rather than entering PENDING_STOP).
        const dwellSec = state.lastMovingAt
          ? (position.capturedAt.getTime() - state.lastMovingAt.getTime()) / 1000
          : 0;
        const ignitionOff = position.ignitionOn === false;
        if (dwellSec >= thresholds.minStopDurationS || ignitionOff) {
          return closeTrip(
            { ...state, distanceM: newDistance, maxSpeedKmh: newMaxSpeed },
            position,
            thresholds,
            events,
          );
        }
        return {
          state: {
            ...state,
            state: 'PENDING_STOP',
            distanceM: newDistance,
            maxSpeedKmh: newMaxSpeed,
          },
          events: [],
        };
      }
      // Still moving — accumulate distance, refresh lastMovingAt.
      return {
        state: {
          ...state,
          distanceM: newDistance,
          maxSpeedKmh: newMaxSpeed,
          lastMovingAt: position.capturedAt,
        },
        events: [],
      };
    }

    case 'PENDING_STOP': {
      if (gapBreaks) {
        return closeTrip(state, position, thresholds, events);
      }
      const newDistance = state.distanceM + distanceStepM;
      if (moving) {
        // Movement resumed within min-stop-duration → it was a traffic-light
        // pause, not a real stop. Return to MOVING, increment stop count.
        return {
          state: {
            ...state,
            state: 'MOVING',
            distanceM: newDistance,
            maxSpeedKmh: Math.max(state.maxSpeedKmh, speed),
            lastMovingAt: position.capturedAt,
            stopCount: state.stopCount + 1,
          },
          events: [],
        };
      }
      // Still pending — check dwell.
      const dwellSec = state.lastMovingAt
        ? (position.capturedAt.getTime() - state.lastMovingAt.getTime()) / 1000
        : 0;
      const ignitionOff = position.ignitionOn === false;
      if (dwellSec >= thresholds.minStopDurationS || ignitionOff) {
        return closeTrip(state, position, thresholds, events);
      }
      return {
        state: { ...state, distanceM: newDistance },
        events: [],
      };
    }

    default: {
      // CLOSED (terminal) → reset to STOP for the next trip.
      return { state: { ...INITIAL_TRIP_FSM }, events };
    }
  }
}

/** Close the current trip: emit trip.ended (+ stop.detected) if it was real. */
function closeTrip(
  state: TripFsmState,
  position: PositionEvent,
  thresholds: TripEngineThresholds,
  events: (TripBoundaryEvent | StopDetectedEvent)[],
): TripFsmOutput {
  const distanceKm = state.distanceM / 1000;
  const durationSec = state.tripStartAt
    ? (position.capturedAt.getTime() - state.tripStartAt.getTime()) / 1000
    : 0;

  // Micro-trip discard: below min-trip-distance → no events, silent reset.
  if (state.distanceM < thresholds.minTripDistanceM) {
    return { state: { ...INITIAL_TRIP_FSM }, events: [] };
  }

  const endedEvent: TripBoundaryEvent = {
    type: 'trip.ended',
    vehicleId: position.vehicleId,
    tenantId: position.tenantId,
    startLat: state.startLat ?? position.latitude,
    startLng: state.startLng ?? position.longitude,
    endLat: position.latitude,
    endLng: position.longitude,
    startedAt: state.tripStartAt ?? position.capturedAt,
    endedAt: position.capturedAt,
    distanceKm,
    durationSec,
    maxSpeedKmh: state.maxSpeedKmh,
    stopCount: state.stopCount,
  };
  events.push(endedEvent);

  // Stop detected at the trip's end location (07 §5.3).
  events.push({
    type: 'stop.detected',
    vehicleId: position.vehicleId,
    tenantId: position.tenantId,
    lat: position.latitude,
    lng: position.longitude,
    arrivedAt: position.capturedAt,
    purpose: 'UNRESOLVED',
  });

  return { state: { ...INITIAL_TRIP_FSM }, events };
}

/**
 * Parking FSM — per-vehicle parking detection (07 §5.5).
 *
 * Parking = stationary WITH ignition OFF, sustained ≥ parking-threshold-s.
 * Distinct from idle (idle = ign on + stationary) and stop (trip boundary).
 * `parking.tamper` = movement while parked + ignition off (vehicle moved/towed).
 *
 * States: UNPARKED → PARKED (after dwell) → UNPARKED (on movement/ignition on).
 *
 * Pure: takes state + position + thresholds, returns new state + events.
 */
import type { PositionEvent } from '../../domain/position-event.js';
import type {
  ParkingEvent,
  ParkingFsmState,
  TripEngineThresholds,
} from '../../domain/trip/trip-types.js';
import { INITIAL_PARKING_FSM } from '../../domain/trip/trip-types.js';

export interface ParkingFsmInput {
  readonly state: ParkingFsmState;
  readonly position: PositionEvent;
  readonly thresholds: TripEngineThresholds;
}

export interface ParkingFsmOutput {
  readonly state: ParkingFsmState;
  readonly events: readonly ParkingEvent[];
}

/** Advance the parking FSM by one position. Pure. */
export function advanceParkingFsm(input: ParkingFsmInput): ParkingFsmOutput {
  const { state, position, thresholds } = input;
  const events: ParkingEvent[] = [];
  const ignitionOff = position.ignitionOn === false;
  const moving = position.speedKph > thresholds.idleSpeedKmh;

  switch (state.state) {
    case 'UNPARKED': {
      if (ignitionOff && !moving) {
        // Begin the parking candidate (ignition off + stationary).
        if (state.parkedAt) {
          // Already have a candidate — check threshold.
          const dwellSec = (position.capturedAt.getTime() - state.parkedAt.getTime()) / 1000;
          if (dwellSec >= thresholds.parkingThresholdS) {
            events.push({
              type: 'parking.started',
              vehicleId: position.vehicleId,
              tenantId: position.tenantId,
              startedAt: state.parkedAt,
              endedAt: position.capturedAt,
              lat: position.latitude,
              lng: position.longitude,
              durationSec: dwellSec,
            });
            return {
              state: {
                state: 'PARKED',
                parkedAt: state.parkedAt,
                lat: position.latitude,
                lng: position.longitude,
              },
              events,
            };
          }
          return { state, events: [] };
        }
        return {
          state: {
            ...state,
            parkedAt: position.capturedAt,
            lat: position.latitude,
            lng: position.longitude,
          },
          events: [],
        };
      }
      // Ignition on or moving → cancel any candidate.
      if (state.parkedAt) {
        return { state: { ...INITIAL_PARKING_FSM }, events: [] };
      }
      return { state, events: [] };
    }

    case 'PARKED': {
      if (moving && ignitionOff) {
        // Tamper: moved while parked + ignition off.
        events.push({
          type: 'parking.tamper',
          vehicleId: position.vehicleId,
          tenantId: position.tenantId,
          startedAt: state.parkedAt,
          endedAt: position.capturedAt,
          lat: position.latitude,
          lng: position.longitude,
          durationSec: state.parkedAt
            ? (position.capturedAt.getTime() - state.parkedAt.getTime()) / 1000
            : 0,
        });
        return { state: { ...INITIAL_PARKING_FSM }, events };
      }
      if (moving || position.ignitionOn === true) {
        // Parking ended — vehicle moved or ignition turned on.
        const durationSec = state.parkedAt
          ? (position.capturedAt.getTime() - state.parkedAt.getTime()) / 1000
          : 0;
        events.push({
          type: 'parking.ended',
          vehicleId: position.vehicleId,
          tenantId: position.tenantId,
          startedAt: state.parkedAt,
          endedAt: position.capturedAt,
          lat: position.latitude,
          lng: position.longitude,
          durationSec,
        });
        return { state: { ...INITIAL_PARKING_FSM }, events };
      }
      return { state, events: [] };
    }

    default:
      return { state, events: [] };
  }
}

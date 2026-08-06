import { describe, expect, it } from '@jest/globals';
import { advanceTripFsm } from '../application/fsm/trip-fsm.js';
import { PositionEvent } from '../domain/position-event.js';
import {
  INITIAL_TRIP_FSM,
  type TripEngineThresholds,
  type TripFsmState,
} from '../domain/trip/trip-types.js';

const THRESHOLDS: TripEngineThresholds = {
  tripStartSpeedKmh: 10,
  tripStartDurationS: 30,
  minTripDistanceM: 250,
  tripStopSpeedKmh: 3,
  minStopDurationS: 300,
  maxGapInTripS: 600,
  idleSpeedKmh: 1,
  idleThresholdS: 180,
  idleAlertThresholdS: 900,
  parkingThresholdS: 1800,
  dedupeDistanceM: 1,
  maxPlausibleSpeedKmh: 300,
};

const T0 = new Date('2026-08-06T10:00:00Z');
const T30 = new Date('2026-08-06T10:00:30Z');
const T60 = new Date('2026-08-06T10:01:00Z');
const T400 = new Date('2026-08-06T10:06:40Z'); // 400s later (> minStopDuration 300)

function pos(speed: number, at: Date, ignition: boolean | null = true, lat = 22.9): PositionEvent {
  return new PositionEvent({
    messageId: `m-${at.getTime()}`,
    vehicleId: 'v1',
    tenantId: 't1',
    latitude: lat,
    longitude: 113.4,
    speedKph: speed,
    headingDeg: 0,
    altitudeM: null,
    satellites: null,
    ignitionOn: ignition,
    capturedAt: at,
    ingestedAt: at,
    protocolId: 'gt06',
    quality: 'VALID',
  });
}

/** Run a sequence of positions through the FSM from the initial state. */
function runSequence(positions: PositionEvent[], distanceSteps: number[]) {
  let state: TripFsmState = { ...INITIAL_TRIP_FSM };
  const types: string[] = [];
  let prev: PositionEvent | null = null;
  for (let i = 0; i < positions.length; i++) {
    const out = advanceTripFsm({
      state,
      position: positions[i] ?? pos(0, T0),
      prevPosition: prev,
      distanceStepM: distanceSteps[i] ?? 0,
      thresholds: THRESHOLDS,
    });
    state = out.state;
    for (const e of out.events) types.push(e.type);
    prev = positions[i] ?? null;
  }
  return { state, types };
}

describe('advanceTripFsm (07 §5.2)', () => {
  it('transitions STOP→MOVING on the first moving position, emitting trip.started', () => {
    const { state, types } = runSequence([pos(50, T0)], [0]);
    expect(state.state).toBe('MOVING');
    expect(types).toContain('trip.started');
  });

  it('stays STOP when speed is below the start threshold', () => {
    const { state, types } = runSequence([pos(5, T0)], [0]);
    expect(state.state).toBe('STOP');
    expect(types).toHaveLength(0);
  });

  it('transitions MOVING→PENDING_STOP on slow speed', () => {
    const { state } = runSequence([pos(50, T0), pos(0, T30)], [0, 100]);
    expect(state.state).toBe('PENDING_STOP');
  });

  it('recovers PENDING_STOP→MOVING (traffic-light pause) with stopCount++', () => {
    const { state } = runSequence([pos(50, T0), pos(0, T30), pos(50, T60)], [0, 100, 100]);
    expect(state.state).toBe('MOVING');
    expect(state.stopCount).toBe(1);
  });

  it('closes the trip (PENDING_STOP→CLOSED) after min-stop-duration, emitting trip.ended', () => {
    // Moving, then slow for 400s (> minStopDuration 300), with enough distance.
    const { state, types } = runSequence(
      [pos(50, T0), pos(0, T400)],
      [0, 300], // 300m distance → ≥ minTripDistance 250
    );
    expect(state.state).toBe('STOP'); // CLOSED resets to STOP
    expect(types).toContain('trip.ended');
    expect(types).toContain('stop.detected');
  });

  it('discards a micro-trip (< minTripDistance) with no trip.ended event', () => {
    const { state, types } = runSequence(
      [pos(50, T0), pos(0, T400)],
      [0, 100], // 100m < 250m minTripDistance
    );
    expect(state.state).toBe('STOP');
    expect(types).not.toContain('trip.ended');
    expect(types).not.toContain('stop.detected');
  });

  it('force-closes the trip on ignition-off', () => {
    const { state, types } = runSequence([pos(50, T0), pos(0, T30, false)], [0, 300]);
    expect(types).toContain('trip.ended');
    expect(state.state).toBe('STOP');
  });

  it('breaks a trip on a long GPS gap (≥ maxGapInTripS)', () => {
    const T700 = new Date(T0.getTime() + 700_000); // >600s gap
    const { state, types } = runSequence([pos(50, T0), pos(50, T700)], [0, 300]);
    expect(types).toContain('trip.ended');
    expect(state.state).toBe('STOP');
  });
});

import { describe, expect, it } from '@jest/globals';
import { advanceParkingFsm } from '../application/fsm/parking-fsm.js';
import { PositionEvent } from '../domain/position-event.js';
import { INITIAL_PARKING_FSM, type TripEngineThresholds } from '../domain/trip/trip-types.js';

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
const T1900 = new Date('2026-08-06T10:31:40Z'); // 1900s (> parkingThreshold 1800)

function pos(speed: number, ignition: boolean | null, at: Date): PositionEvent {
  return new PositionEvent({
    messageId: `m-${at.getTime()}`,
    vehicleId: 'v1',
    tenantId: 't1',
    latitude: 22.9,
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

describe('advanceParkingFsm (07 §5.5)', () => {
  it('does not park while ignition is on', () => {
    const out = advanceParkingFsm({
      state: { ...INITIAL_PARKING_FSM },
      position: pos(0, true, T0),
      thresholds: THRESHOLDS,
    });
    expect(out.state.state).toBe('UNPARKED');
    expect(out.state.parkedAt).toBeNull();
    expect(out.events).toHaveLength(0);
  });

  it('opens a parking candidate when ignition off + stationary', () => {
    const out = advanceParkingFsm({
      state: { ...INITIAL_PARKING_FSM },
      position: pos(0, false, T0),
      thresholds: THRESHOLDS,
    });
    expect(out.state.parkedAt).not.toBeNull();
    expect(out.state.state).toBe('UNPARKED'); // not yet parked (below threshold)
  });

  it('emits parking.started after the threshold is reached', () => {
    // Open candidate at T0, then check at T1900 (> 1800s threshold).
    let state = { ...INITIAL_PARKING_FSM };
    state = advanceParkingFsm({
      state,
      position: pos(0, false, T0),
      thresholds: THRESHOLDS,
    }).state;
    const out = advanceParkingFsm({
      state,
      position: pos(0, false, T1900),
      thresholds: THRESHOLDS,
    });
    expect(out.state.state).toBe('PARKED');
    expect(out.events.find((e) => e.type === 'parking.started')).toBeDefined();
  });

  it('emits parking.ended when ignition turns on', () => {
    let state = { ...INITIAL_PARKING_FSM };
    state = advanceParkingFsm({ state, position: pos(0, false, T0), thresholds: THRESHOLDS }).state;
    state = advanceParkingFsm({
      state,
      position: pos(0, false, T1900),
      thresholds: THRESHOLDS,
    }).state;
    expect(state.state).toBe('PARKED');
    const out = advanceParkingFsm({
      state,
      position: pos(30, true, new Date(T1900.getTime() + 60_000)),
      thresholds: THRESHOLDS,
    });
    expect(out.events.find((e) => e.type === 'parking.ended')).toBeDefined();
    expect(out.state.state).toBe('UNPARKED');
  });

  it('emits parking.tamper when the vehicle moves while parked + ignition off', () => {
    let state = { ...INITIAL_PARKING_FSM };
    state = advanceParkingFsm({ state, position: pos(0, false, T0), thresholds: THRESHOLDS }).state;
    state = advanceParkingFsm({
      state,
      position: pos(0, false, T1900),
      thresholds: THRESHOLDS,
    }).state;
    // Moved while ignition still off → tamper.
    const out = advanceParkingFsm({
      state,
      position: pos(30, false, new Date(T1900.getTime() + 60_000)),
      thresholds: THRESHOLDS,
    });
    expect(out.events.find((e) => e.type === 'parking.tamper')).toBeDefined();
  });
});

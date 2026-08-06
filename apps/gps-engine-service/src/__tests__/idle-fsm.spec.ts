import { describe, expect, it } from '@jest/globals';
import { advanceIdleFsm } from '../application/fsm/idle-fsm.js';
import { PositionEvent } from '../domain/position-event.js';
import { INITIAL_IDLE_FSM, type TripEngineThresholds } from '../domain/trip/trip-types.js';

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
const T200 = new Date('2026-08-06T10:03:20Z'); // 200s (> idleThreshold 180)
const T950 = new Date('2026-08-06T10:15:50Z'); // 950s (> idleAlert 900)

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

describe('advanceIdleFsm (07 §5.4)', () => {
  it('does not idle when ignition is off', () => {
    let state = { ...INITIAL_IDLE_FSM };
    const out = advanceIdleFsm({
      state,
      position: pos(0, false, T0),
      thresholds: THRESHOLDS,
    });
    state = out.state;
    expect(state.state).toBe('ACTIVE');
    expect(out.events).toHaveLength(0);
  });

  it('opens an idle candidate when ignition on + stationary', () => {
    const out = advanceIdleFsm({
      state: { ...INITIAL_IDLE_FSM },
      position: pos(0, true, T0),
      thresholds: THRESHOLDS,
    });
    // First position sets idleStartAt but doesn't transition yet.
    expect(out.state.idleStartAt).not.toBeNull();
  });

  it('emits idle.started after the threshold is reached', () => {
    // Open candidate at T0, then check at T200 (> 180s threshold).
    let state = { ...INITIAL_IDLE_FSM };
    state = advanceIdleFsm({ state, position: pos(0, true, T0), thresholds: THRESHOLDS }).state;
    const out = advanceIdleFsm({ state, position: pos(0, true, T200), thresholds: THRESHOLDS });
    expect(out.state.state).toBe('IDLE');
    expect(out.events.find((e) => e.type === 'idle.started')).toBeDefined();
  });

  it('emits idle.ended when movement resumes', () => {
    // Reach IDLE state, then move.
    let state = { ...INITIAL_IDLE_FSM };
    state = advanceIdleFsm({ state, position: pos(0, true, T0), thresholds: THRESHOLDS }).state;
    state = advanceIdleFsm({ state, position: pos(0, true, T200), thresholds: THRESHOLDS }).state;
    const out = advanceIdleFsm({ state, position: pos(50, true, T950), thresholds: THRESHOLDS });
    expect(out.events.find((e) => e.type === 'idle.ended')).toBeDefined();
    expect(out.state.state).toBe('ACTIVE');
  });

  it('emits idle.alert after the alert threshold (once per window)', () => {
    let state = { ...INITIAL_IDLE_FSM };
    state = advanceIdleFsm({ state, position: pos(0, true, T0), thresholds: THRESHOLDS }).state;
    state = advanceIdleFsm({ state, position: pos(0, true, T200), thresholds: THRESHOLDS }).state;
    const out = advanceIdleFsm({ state, position: pos(0, true, T950), thresholds: THRESHOLDS });
    expect(out.events.find((e) => e.type === 'idle.alert')).toBeDefined();
    expect(out.state.alerted).toBe(true);
  });
});

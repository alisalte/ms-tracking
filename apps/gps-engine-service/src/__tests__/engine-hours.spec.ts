import { describe, expect, it } from '@jest/globals';
import { advanceEngineHours } from '../application/fsm/engine-hours.js';
import { PositionEvent } from '../domain/position-event.js';

const T0 = new Date('2026-08-06T10:00:00Z');
const T60 = new Date('2026-08-06T10:01:00Z'); // +60s

function pos(ignitionOn: boolean | null, at: Date, speed = 30): PositionEvent {
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
    ignitionOn,
    capturedAt: at,
    ingestedAt: at,
    protocolId: 'gt06',
    quality: 'VALID',
  });
}

describe('advanceEngineHours (07 §5.6)', () => {
  it('accumulates Δt while ignition stays on', () => {
    const prev = pos(true, T0);
    const curr = pos(true, T60);
    const out = advanceEngineHours({ accumulatedSec: 100, prevPosition: prev, position: curr });
    expect(out.accumulatedSec).toBe(160); // 100 + 60s
    expect(out.flushed).toBeNull();
  });

  it('flushes on ignition-off edge', () => {
    const prev = pos(true, T0);
    const curr = pos(false, T60);
    const out = advanceEngineHours({ accumulatedSec: 200, prevPosition: prev, position: curr });
    expect(out.accumulatedSec).toBe(0);
    expect(out.flushed).toBe(260); // 200 + 60s
  });

  it('does not accumulate while ignition is off throughout', () => {
    const prev = pos(false, T0);
    const curr = pos(false, T60);
    const out = advanceEngineHours({ accumulatedSec: 0, prevPosition: prev, position: curr });
    expect(out.accumulatedSec).toBe(0);
    expect(out.flushed).toBeNull();
  });

  it('returns no accrual on the first sighting (no prev)', () => {
    const curr = pos(true, T0);
    const out = advanceEngineHours({ accumulatedSec: 0, prevPosition: null, position: curr });
    expect(out.accumulatedSec).toBe(0);
    expect(out.flushed).toBeNull();
  });
});

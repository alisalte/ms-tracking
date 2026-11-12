import { describe, expect, it } from '@jest/globals';
import { TripRepository, wholeSeconds } from '../infrastructure/persistence/trip.repository.js';

describe('wholeSeconds', () => {
  it('rounds fractional seconds (device timestamps with milliseconds)', () => {
    expect(wholeSeconds(4615.468)).toBe(4615);
    expect(wholeSeconds(4615.5)).toBe(4616);
    expect(wholeSeconds(0)).toBe(0);
  });

  it('never returns a negative or non-finite duration', () => {
    expect(wholeSeconds(-0.4)).toBe(0);
    expect(wholeSeconds(-12)).toBe(0);
    expect(wholeSeconds(Number.NaN)).toBe(0);
  });
});

describe('TripRepository integer duration column', () => {
  const base = {
    vehicleId: '00000000-0000-0000-0000-000000000001',
    tenantId: '00000000-0000-0000-0000-000000000002',
    startLat: 1,
    startLng: 1,
    endLat: 2,
    endLng: 2,
    startedAt: new Date('2026-11-12T07:00:00Z'),
    endedAt: new Date('2026-11-12T08:17:55.468Z'),
    distanceKm: 3.2,
  };

  function capture() {
    const calls: unknown[][] = [];
    const knex = {
      raw: async (_sql: string, bindings: unknown[]) => {
        calls.push(bindings);
        return { rowCount: 1 };
      },
    };
    return { calls, repo: new TripRepository(knex as never) };
  }

  it('discardTrip binds a whole number of seconds', async () => {
    const { calls, repo } = capture();
    await repo.discardTrip({
      ...base,
      type: 'trip.discarded',
      durationSec: 4615.468,
      reason: 'MICRO_TRIP',
    } as never);
    expect(calls[0]?.[4]).toBe(4615);
  });

  it('completeTrip binds a whole number of seconds', async () => {
    const { calls, repo } = capture();
    await repo.completeTrip({
      ...base,
      type: 'trip.ended',
      durationSec: 4615.468,
      maxSpeedKmh: 80,
      stopCount: 1,
    } as never);
    expect(calls[0]?.[4]).toBe(4615);
  });
});

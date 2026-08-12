import { describe, expect, it } from '@jest/globals';
import { TripRepository } from '../infrastructure/persistence/trip.repository.js';

/**
 * Sprint 2 bug 5d: engine-hours flushed windows were discarded (`void
 * engineHoursFlushed`) and never persisted. Now TripRepository.insertEngineHours
 * exists and persistEvents calls it. This test pins the repository contract.
 */
describe('TripRepository.insertEngineHours (bug 5d)', () => {
  it('inserts a row into tracking.engine_hours', async () => {
    const inserts: { table: string; row: Record<string, unknown> }[] = [];
    const fakeKnex = {
      withSchema(schema: string) {
        return {
          from(table: string) {
            return {
              insert(row: Record<string, unknown>) {
                inserts.push({ table: `${schema}.${table}`, row });
                return Promise.resolve();
              },
            };
          },
        };
      },
      raw(sql: string, params: unknown[]) {
        return { sql, params };
      },
    };
    const repo = new TripRepository(fakeKnex as never);
    await repo.insertEngineHours({
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      vehicleId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      accumulatedSec: 1800,
      at: new Date('2026-01-01T00:00:00Z'),
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.table).toBe('tracking.engine_hours');
    expect(inserts[0]?.row.accumulated_sec).toBe(1800);
  });
});

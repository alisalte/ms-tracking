import { describe, expect, it } from '@jest/globals';

import { SummaryService } from '../application/summary.service.js';
import { DeviceRepository } from '../infrastructure/persistence/device.repository.js';

/**
 * Sprint E §21 — the dashboard count aggregate. Three GROUP BY counts merged
 * into the wire shape the frontend's stat cards consume. Also pins the Sprint E
 * device-list extension: `vehicleId` rides on every list row (scalar subquery)
 * and `toRecord` maps it.
 */
describe('SummaryService (Sprint E §21)', () => {
  const TENANT = '22222222-2222-4222-8222-222222222222';

  function makeService(counts: {
    fleets?: Record<string, number>;
    vehicles?: Record<string, number>;
    devices?: Record<string, number>;
  }) {
    const fleets = { countByStatus: async () => counts.fleets ?? {} };
    const vehicles = { countByStatus: async () => counts.vehicles ?? {} };
    const devices = { countByStatus: async () => counts.devices ?? {} };
    return new SummaryService(fleets as never, vehicles as never, devices as never);
  }

  it('aggregates fleet/vehicle/device counts by status', async () => {
    const summary = await makeService({
      fleets: { ACTIVE: 3, ARCHIVED: 1 },
      vehicles: { ACTIVE: 12, ARCHIVED: 2 },
      devices: { ACTIVE: 10, SUSPENDED: 1, DECOMMISSIONED: 2, UNPAIRED: 5 },
    }).get(TENANT);
    expect(summary).toEqual({
      fleets: { active: 3, archived: 1 },
      vehicles: { active: 12, archived: 2 },
      devices: {
        byStatus: { ACTIVE: 10, SUSPENDED: 1, DECOMMISSIONED: 2, UNPAIRED: 5 },
        total: 18,
      },
    });
  });

  it('returns zeroed counts for an empty tenant (never throws)', async () => {
    const summary = await makeService({}).get(TENANT);
    expect(summary.fleets).toEqual({ active: 0, archived: 0 });
    expect(summary.vehicles).toEqual({ active: 0, archived: 0 });
    expect(summary.devices).toEqual({ byStatus: {}, total: 0 });
  });

  it('ignores unexpected status values gracefully (counts pass through)', async () => {
    const summary = await makeService({ fleets: { WEIRD: 2 } }).get(TENANT);
    expect(summary.fleets).toEqual({ active: 0, archived: 0 }); // only known keys exposed
  });
});

describe('DeviceRepository.toRecord — vehicleId on the list wire (Sprint E)', () => {
  const baseRow = {
    id: 'd-1',
    tenant_id: 't-1',
    imei: '123456789012345',
    serial_number: null,
    manufacturer: 'Teltonika',
    model: 'FMB920',
    protocol: 'gt06' as const,
    status: 'ACTIVE' as const,
    last_seen_at: null,
    connected_at: null,
    disconnected_at: null,
    version: 1,
    created_at: new Date('2026-08-15T00:00:00Z'),
    updated_at: new Date('2026-08-15T00:00:00Z'),
  };

  it('maps the bound vehicle when the list subquery populated vehicle_id', () => {
    const record = DeviceRepository.toRecord({ ...baseRow, vehicle_id: 'v-9' });
    expect(record.vehicleId).toBe('v-9');
  });

  it('falls back to null when the row carries no vehicle_id (detail reads)', () => {
    const record = DeviceRepository.toRecord({ ...baseRow });
    expect(record.vehicleId).toBeNull();
  });
});

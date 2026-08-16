import { describe, expect, it } from '@jest/globals';

import { PositionsController } from '../api/positions.controller.js';
import { TripsController } from '../api/trips.controller.js';

/**
 * Sprint F spatial + trip endpoints:
 *   GET /positions/nearby      — PostGIS nearest-vehicles query (validation + tenant scoping)
 *   GET /positions/in-bounds   — viewport bbox query (validation + tenant scoping)
 *   GET /positions/:id?from/to — historical track (Sprint F §21 time-range hardening)
 *   GET /trips, /trips/:id     — trip list/detail from existing projections (§11)
 *
 * These tests pin the VALIDATION and tenant propagation; the SQL itself is
 * exercised by the real-PG integration suites.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const okPos = {
  vehicleId: 'v1',
  tenantId: TENANT_A,
  latitude: 35.7,
  longitude: 51.4,
  speedKph: 30,
  headingDeg: 90,
  altitudeM: null,
  ignitionOn: true,
  capturedAt: new Date(),
  ingestedAt: new Date(),
  quality: 1,
};

function makePositionsController() {
  const nearbyCalls: unknown[][] = [];
  const boundsCalls: unknown[][] = [];
  const rangeCalls: unknown[][] = [];
  const repo = {
    findLatestForTenant: async () => [],
    findLatest: async () => null,
    findRange: async (...args: unknown[]) => {
      rangeCalls.push(args);
      return [];
    },
    findNearby: async (...args: unknown[]) => {
      nearbyCalls.push(args);
      return [{ ...okPos, distanceM: 123.4 }];
    },
    findInBounds: async (...args: unknown[]) => {
      boundsCalls.push(args);
      return [okPos];
    },
  };
  const cache = { getLatest: async () => null };
  return {
    controller: new PositionsController(cache as never, repo as never, { HISTORY_MAX_RANGE_DAYS: 31 } as never, null as never),
    nearbyCalls,
    boundsCalls,
    rangeCalls,
  };
}

describe('GET /positions/nearby (Sprint F §17)', () => {
  it('rejects invalid coordinates with 400', async () => {
    const { controller } = makePositionsController();
    await expect(controller.nearby(TENANT_A, 'abc', '51.4')).rejects.toThrow(/Valid lat/);
    await expect(controller.nearby(TENANT_A, '35.7')).rejects.toThrow(/Valid lng/);
  });

  it('rejects an out-of-bounds radius with 400', async () => {
    const { controller } = makePositionsController();
    await expect(controller.nearby(TENANT_A, '35.7', '51.4', '0')).rejects.toThrow(/radius/);
    await expect(controller.nearby(TENANT_A, '35.7', '51.4', '500000')).rejects.toThrow(/radius/);
  });

  it('passes the verified tenant + parsed coordinates to the spatial query', async () => {
    const { controller, nearbyCalls } = makePositionsController();
    const result = await controller.nearby(TENANT_A, '35.7', '51.4', '2000', '10');
    expect(nearbyCalls[0]?.slice(0, 4)).toEqual([TENANT_A, 35.7, 51.4, 2000]);
    expect(nearbyCalls[0]?.[4]).toBe(10);
    expect(result[0]).toMatchObject({ vehicleId: 'v1', distanceM: 123.4 });
  });

  it('never queries with another tenant scope (tenant comes from the JWT)', async () => {
    const { controller, nearbyCalls } = makePositionsController();
    await controller.nearby(TENANT_B, '35.7', '51.4');
    expect(nearbyCalls[0]?.[0]).toBe(TENANT_B);
    expect(nearbyCalls[0]?.[0]).not.toBe(TENANT_A);
  });
});

describe('GET /positions/in-bounds (Sprint F §18)', () => {
  it('rejects unordered bounds with 400', async () => {
    const { controller } = makePositionsController();
    await expect(controller.inBounds(TENANT_A, '35.6', '35.8', '51.5', '51.3')).rejects.toThrow(
      /ordered/,
    );
  });

  it('rejects invalid coordinates with 400', async () => {
    const { controller } = makePositionsController();
    await expect(controller.inBounds(TENANT_A, 'x', '35.6', '51.5', '51.3')).rejects.toThrow(
      /Valid north/,
    );
  });

  it('passes the verified tenant + ordered bounds to the spatial query', async () => {
    const { controller, boundsCalls } = makePositionsController();
    await controller.inBounds(TENANT_A, '35.8', '35.6', '51.5', '51.3');
    // repository signature: (tenantId, minLng, minLat, maxLng, maxLat, limit)
    expect(boundsCalls[0]?.slice(0, 5)).toEqual([TENANT_A, 51.3, 35.6, 51.5, 35.8]);
  });
});

describe('GET /positions/:vehicleId (historical track — Sprint F §21; Sprint I §30 adds preset)', () => {
  it('rejects invalid timestamps with 400', async () => {
    const { controller } = makePositionsController();
    await expect(
      controller.range('v1', TENANT_A, undefined, 'not-a-date'),
    ).rejects.toThrow(/ISO timestamps/);
  });

  it('rejects reversed ranges with 400', async () => {
    const { controller } = makePositionsController();
    await expect(
      controller.range(
        'v1',
        TENANT_A,
        undefined,
        '2026-08-15T10:00:00Z',
        '2026-08-15T09:00:00Z',
      ),
    ).rejects.toThrow(/from must be before to/);
  });

  it('rejects ranges beyond 31 days with 400', async () => {
    const { controller } = makePositionsController();
    await expect(
      controller.range(
        'v1',
        TENANT_A,
        undefined,
        '2026-06-01T00:00:00Z',
        '2026-08-15T00:00:00Z',
      ),
    ).rejects.toThrow(/31 days/);
  });

  it('defaults to the last 24h and clamps the limit', async () => {
    const { controller, rangeCalls } = makePositionsController();
    await controller.range('v1', TENANT_A, undefined, undefined, undefined, '999999');
    const [tenant, vehicle, from, to, limit] = rangeCalls[0] as [
      string,
      string,
      Date,
      Date,
      number,
    ];
    expect(tenant).toBe(TENANT_A);
    expect(vehicle).toBe('v1');
    expect(to.getTime() - from.getTime()).toBeGreaterThan(23 * 3600 * 1000);
    expect(to.getTime() - from.getTime()).toBeLessThanOrEqual(24 * 3600 * 1000 + 1000);
    expect(limit).toBe(10_000);
  });
});

describe('GET /trips + /trips/:tripId (Sprint F §11)', () => {
  const trip = {
    id: 't1',
    vehicleId: 'v1',
    tenantId: TENANT_A,
    status: 'COMPLETED' as const,
    startedAt: new Date('2026-08-15T08:00:00Z'),
    endedAt: new Date('2026-08-15T09:00:00Z'),
    startLat: 35.7,
    startLng: 51.4,
    endLat: 35.75,
    endLng: 51.45,
    distanceKm: 60,
    durationS: 3600,
    maxSpeedKmh: 90,
    stopCount: 1,
  };

  function makeTripsController() {
    const listCalls: unknown[][] = [];
    const trips = {
      findTrips: async (...args: unknown[]) => {
        listCalls.push(args);
        return [trip];
      },
      findTripById: async (tenantId: string, tripId: string) =>
        tripId === 't1' && tenantId === TENANT_A ? trip : null,
      findIdlePeriods: async () => [
        {
          startedAt: new Date('2026-08-15T08:20:00Z'),
          endedAt: new Date('2026-08-15T08:30:00Z'),
          durationS: 600,
        },
      ],
      findParkingPeriods: async () => [
        {
          startedAt: new Date('2026-08-15T08:40:00Z'),
          endedAt: null,
          durationS: 120,
          lat: 35.72,
          lng: 51.42,
        },
      ],
    };
    const positions = {
      findRange: async () => [
        { ...okPos, capturedAt: new Date('2026-08-15T08:00:00Z'), speedKph: 50 },
        { ...okPos, capturedAt: new Date('2026-08-15T09:00:00Z'), speedKph: 70 },
      ],
    };
    return {
      controller: new TripsController(trips as never, positions as never),
      listCalls,
    };
  }

  it('lists trips with a validated window and vehicle filter', async () => {
    const { controller, listCalls } = makeTripsController();
    const result = await controller.list(
      TENANT_A,
      'v1',
      '2026-08-14T00:00:00Z',
      '2026-08-15T00:00:00Z',
      '10',
    );
    const [tenant, opts] = listCalls[0] as [string, { vehicleId?: string; limit?: number }];
    expect(tenant).toBe(TENANT_A);
    expect(opts.vehicleId).toBe('v1');
    expect(opts.limit).toBe(10);
    expect(result).toHaveLength(1);
  });

  it('rejects invalid trip-list ranges with 400', async () => {
    const { controller } = makeTripsController();
    await expect(controller.list(TENANT_A, undefined, 'bad')).rejects.toThrow(/ISO timestamps/);
    await expect(
      controller.list(TENANT_A, undefined, '2026-08-15T10:00:00Z', '2026-08-15T09:00:00Z'),
    ).rejects.toThrow(/from must be before to/);
  });

  it('composes trip detail with real waypoints + idle/parking events + avg speed', async () => {
    const { controller } = makeTripsController();
    const detail = await controller.detail(TENANT_A, 't1');
    expect(detail).toMatchObject({
      id: 't1',
      distanceKm: 60,
      durationS: 3600,
      avgSpeedKph: 60,
    });
    expect(detail.waypoints).toHaveLength(2);
    expect(detail.waypoints[0]).toMatchObject({ lat: 35.7, lng: 51.4, speed: 50 });
    const types = (detail.events as Array<{ type: string }>).map((e) => e.type);
    expect(types).toEqual(['idle', 'stop']);
  });

  it('404s cross-tenant trip ids without leaking existence', async () => {
    const { controller } = makeTripsController();
    await expect(controller.detail(TENANT_B, 't1')).rejects.toThrow(/not found/i);
    await expect(controller.detail(TENANT_A, 'nope')).rejects.toThrow(/not found/i);
  });
});

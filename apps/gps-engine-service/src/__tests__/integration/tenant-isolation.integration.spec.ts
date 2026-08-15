import type { Knex } from '@fleetvision/persistence-knex';
/**
 * Sprint B — cross-tenant isolation integration tests for the gps-engine
 * repositories, against a real PostgreSQL + TimescaleDB instance.
 *
 * These PROVE that tenant A cannot read or mutate tenant B's data, and that the
 * tests would FAIL if the repository's `WHERE tenant_id = ?` filter were
 * removed (each assertion checks the other tenant's rows are not returned /
 * not affected).
 *
 * Gating mirrors the Sprint A harness: skipped (`describe.skip`) when no
 * Postgres is reachable, so `pnpm test` stays green anywhere. Override the
 * server with `GPS_TEST_DBURL`.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { TripBoundaryEvent, TripDiscardedEvent } from '../../domain/trip/trip-types.js';
import { DeviceStatusRepository } from '../../infrastructure/persistence/device-status.repository.js';
import { TripRepository } from '../../infrastructure/persistence/trip.repository.js';
import { dropTestDb, bootstrap as integrationBootstrap } from './db.js';

const TEST_DB_NAME = 'fleetvision_gps_tenant_int_test';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEVICE = '22222222-2222-2222-2222-222222222222';
const OTHER_DEVICE = '33333333-3333-3333-3333-333333333333';

interface Ctx {
  knex: Knex;
  admin: Knex;
  deviceStatus: DeviceStatusRepository;
  trips: TripRepository;
}

async function bootstrap(): Promise<Ctx | null> {
  // Sprint D: uses the shared bootstrap (direct-import migrations) so the suite
  // actually runs under jest (see ./db.ts).
  const ctx = await integrationBootstrap(TEST_DB_NAME);
  return ctx
    ? {
        knex: ctx.knex,
        admin: ctx.admin,
        deviceStatus: new DeviceStatusRepository(ctx.knex),
        trips: new TripRepository(ctx.knex),
      }
    : null;
}

const ctx = await bootstrap();
const d = ctx ? describe : describe.skip;

d('Cross-tenant isolation — device_status', () => {
  // ctx is non-null when d === describe; under describe.skip these are
  // undefined but the suite's tests are skipped and never execute.
  const deviceStatus = ctx?.deviceStatus as DeviceStatusRepository;

  beforeAll(async () => {
    // Tenant A owns DEVICE; tenant B owns OTHER_DEVICE.
    await deviceStatus.upsert({
      deviceId: DEVICE,
      tenantId: TENANT_A,
      state: 'ONLINE',
      protocolId: 'gt06',
      reason: 'LOGIN',
      lastSeenAt: new Date(),
    });
    await deviceStatus.upsert({
      deviceId: OTHER_DEVICE,
      tenantId: TENANT_B,
      state: 'ONLINE',
      protocolId: 'gt06',
      reason: 'LOGIN',
      lastSeenAt: new Date(),
    });
  });

  it('6/7. tenant A reads its own device, not tenant B’s (WS7)', async () => {
    const own = await deviceStatus.find(TENANT_A, DEVICE);
    expect(own?.tenantId).toBe(TENANT_A);
    expect(own?.deviceId).toBe(DEVICE);
  });

  it('tenant A cannot read tenant B’s device by id (find is tenant-scoped)', async () => {
    const leaked = await deviceStatus.find(TENANT_A, OTHER_DEVICE);
    expect(leaked).toBeNull();
  });

  it('tenant B cannot read tenant A’s device by id', async () => {
    const leaked = await deviceStatus.find(TENANT_B, DEVICE);
    expect(leaked).toBeNull();
  });
});

d('Cross-tenant isolation — trip_events (complete/discard)', () => {
  const trips = ctx?.trips as TripRepository;
  const knex = ctx?.knex as Knex;
  const startedAt = new Date('2026-01-01T00:00:00Z');

  function startEvent(tenant: string, vehicle: string): TripBoundaryEvent {
    return {
      type: 'trip.started',
      vehicleId: vehicle,
      tenantId: tenant,
      startLat: 1,
      startLng: 1,
      endLat: 1,
      endLng: 1,
      startedAt,
      endedAt: startedAt,
      distanceKm: 0,
      durationSec: 0,
      maxSpeedKmh: 0,
      stopCount: 0,
    };
  }

  function endEvent(tenant: string, vehicle: string, endedAt: Date): TripBoundaryEvent {
    return {
      type: 'trip.ended',
      vehicleId: vehicle,
      tenantId: tenant,
      startLat: 1,
      startLng: 1,
      endLat: 2,
      endLng: 2,
      startedAt,
      endedAt,
      distanceKm: 5.2,
      durationSec: 600,
      maxSpeedKmh: 80,
      stopCount: 1,
    };
  }

  function discardEvent(tenant: string, vehicle: string, endedAt: Date): TripDiscardedEvent {
    return {
      type: 'trip.discarded',
      vehicleId: vehicle,
      tenantId: tenant,
      startLat: 1,
      startLng: 1,
      endLat: 1,
      endLng: 1,
      startedAt,
      endedAt,
      distanceKm: 0.1,
      durationSec: 5,
      reason: 'MICRO_TRIP',
    };
  }

  it('13/14/15. tenant A closes/discards its own trip; tenant B is untouched', async () => {
    // Two ACTIVE trips on the SAME vehicle id, one per tenant.
    await trips.insertTripStart(startEvent(TENANT_A, DEVICE));
    await trips.insertTripStart(startEvent(TENANT_B, DEVICE));

    // Tenant A completes its trip.
    const closed = await trips.completeTrip(
      endEvent(TENANT_A, DEVICE, new Date(startedAt.getTime() + 600_000)),
    );
    expect(closed.updated).toBe(1);

    // Tenant A discarding a (second, micro) trip must not touch tenant B's row.
    await trips.insertTripStart(startEvent(TENANT_A, DEVICE));
    const discarded = await trips.discardTrip(discardEvent(TENANT_A, DEVICE, new Date()));
    expect(discarded.updated).toBe(1);

    // Tenant B's trip remains ACTIVE (untouched by tenant A's close/discard).
    const bActive = await knex('tracking.trip_events')
      .whereRaw('tenant_id = ?::uuid', [TENANT_B])
      .where('status', 'ACTIVE')
      .count();
    const bCount = Number((bActive[0] as { count: number }).count);
    expect(bCount).toBeGreaterThanOrEqual(1);

    // Tenant B completing via its own tenant-scoped subquery selects ITS newest
    // ACTIVE row (NOT tenant A's rows). Exactly-one close.
    const bClose = await trips.completeTrip(endEvent(TENANT_B, DEVICE, new Date()));
    expect(bClose.updated).toBe(1);
  });
});

afterAll(async () => {
  const c = ctx;
  if (!c) return;
  try {
    await c.knex.destroy();
  } catch {
    /* ignore */
  }
  try {
    await dropTestDb(c.admin, TEST_DB_NAME);
    await c.admin.destroy();
  } catch {
    /* ignore */
  }
});

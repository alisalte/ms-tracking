import type { Knex } from '@fleetvision/persistence-knex';
/**
 * Integration tests for TripRepository against a real PostgreSQL + TimescaleDB
 * instance (Sprint A).
 *
 * These exercise the actual SQL — the deterministic completeTrip/discardTrip
 * subquery pattern, idempotent engine-hours persistence, and tenant isolation —
 * rather than mocks. They spin up a throwaway database (`fleetvision_gps_int_test`)
 * inside the running Postgres, apply the gps-engine migrations (including the
 * Sprint A engine_hours + Timescale policy migrations), and drop it afterwards.
 *
 * Gating: if no Postgres is reachable (no Docker / CI without a DB), the suite
 * is skipped via `describe.skip` so `pnpm test` stays green in any environment.
 * Point at a different server with `GPS_TEST_DBURL`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type {
  EngineHoursFlushedEvent,
  TripBoundaryEvent,
  TripDiscardedEvent,
} from '../../domain/trip/trip-types.js';
import { TripRepository } from '../../infrastructure/persistence/trip.repository.js';
import { dropTestDb, bootstrap as integrationBootstrap } from './db.js';

const TEST_DB_NAME = 'fleetvision_gps_int_test';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const VEHICLE = '22222222-2222-2222-2222-222222222222';

interface Ctx {
  knex: Knex;
  admin: Knex;
  repo: TripRepository;
}

async function bootstrap(): Promise<Ctx | null> {
  // Sprint D: uses the shared bootstrap (direct-import migrations) so the suite
  // actually runs under jest — knex's loader cannot eval ESM `.js` in the
  // vm-module sandbox (pre-existing quirk documented in Sprint C).
  const ctx = await integrationBootstrap(TEST_DB_NAME);
  return ctx ? { knex: ctx.knex, admin: ctx.admin, repo: new TripRepository(ctx.knex) } : null;
}

// Top-level await: decide before Jest collects the suite whether a DB is up.
const ctx = await bootstrap();
const d = ctx ? describe : describe.skip;

// --- event builders --------------------------------------------------------

function startEvent(tenant: string, startedAt: Date): TripBoundaryEvent {
  return {
    type: 'trip.started',
    vehicleId: VEHICLE,
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

function endEvent(tenant: string, startedAt: Date, endedAt: Date): TripBoundaryEvent {
  return {
    type: 'trip.ended',
    vehicleId: VEHICLE,
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

function discardEvent(tenant: string, startedAt: Date, endedAt: Date): TripDiscardedEvent {
  return {
    type: 'trip.discarded',
    vehicleId: VEHICLE,
    tenantId: tenant,
    startLat: 1,
    startLng: 1,
    endLat: 1.0001,
    endLng: 1.0001,
    startedAt,
    endedAt,
    distanceKm: 0.04,
    durationSec: 30,
    reason: 'MICRO_TRIP',
  };
}

function ehEvent(
  tenant: string,
  sourceEventId: string,
  durationSec: number,
  windowEnd: Date,
): EngineHoursFlushedEvent {
  return {
    type: 'engine.hours.flushed',
    vehicleId: VEHICLE,
    tenantId: tenant,
    durationSec,
    windowEnd,
    windowStart: new Date(windowEnd.getTime() - durationSec * 1000),
    engineHours: durationSec / 3600,
    sourceEventId,
  };
}

async function tripRows(
  knex: Knex,
  tenant: string,
): Promise<{ started_at: Date; status: string }[]> {
  return knex
    .withSchema('tracking')
    .from('trip_events')
    .whereRaw('tenant_id = ?::uuid', [tenant])
    .whereRaw('vehicle_id = ?::uuid', [VEHICLE])
    .orderBy('started_at', 'asc')
    .select('started_at', 'status');
}

d('TripRepository (integration: real PostgreSQL)', () => {
  // ctx is non-null when d === describe; under describe.skip these are
  // undefined but the suite's tests are skipped and never execute.
  const knex = ctx?.knex as Knex;
  const repo = ctx?.repo as TripRepository;
  const admin = ctx?.admin as Knex;

  beforeAll(async () => {
    // Sanity: the Sprint A tables + hypertable policies exist.
    const policies = await knex.raw(
      `SELECT count(*)::int AS n FROM timescaledb_information.jobs
        WHERE hypertable_schema = 'tracking' AND hypertable_name = 'vehicle_positions'`,
    );
    expect(Number(policies.rows[0]?.n ?? 0)).toBeGreaterThanOrEqual(2);
  });

  afterEach(async () => {
    await knex.raw(
      'TRUNCATE tracking.trip_events, tracking.engine_hours, tracking.idle_periods, tracking.parking_periods RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await knex.destroy();
    await dropTestDb(admin, TEST_DB_NAME);
    await admin.destroy();
  });

  it('start trip → complete trip: closes the ACTIVE row as COMPLETED', async () => {
    const startedAt = new Date('2026-08-13T10:00:00Z');
    const endedAt = new Date('2026-08-13T10:30:00Z');
    await repo.insertTripStart(startEvent(TENANT_A, startedAt));

    const result = await repo.completeTrip(endEvent(TENANT_A, startedAt, endedAt));

    expect(result.updated).toBe(1);
    const rows = await tripRows(knex, TENANT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('COMPLETED');
    const row = await knex
      .withSchema('tracking')
      .from('trip_events')
      .whereRaw('tenant_id = ?::uuid', [TENANT_A])
      .whereRaw('vehicle_id = ?::uuid', [VEHICLE])
      .select('ended_at', 'end_lat', 'distance_km', 'duration_s', 'max_speed_kmh')
      .first();
    expect(row?.ended_at).toBeInstanceOf(Date);
    expect(Number(row?.distance_km)).toBeCloseTo(5.2, 2);
    expect(Number(row?.max_speed_kmh)).toBe(80);
  });

  it('multiple ACTIVE trips → the newest active trip is closed', async () => {
    const older = new Date('2026-08-13T10:00:00Z');
    const newer = new Date('2026-08-13T11:00:00Z');
    await repo.insertTripStart(startEvent(TENANT_A, older));
    await repo.insertTripStart(startEvent(TENANT_A, newer)); // newest ACTIVE

    const result = await repo.completeTrip(
      endEvent(TENANT_A, newer, new Date('2026-08-13T11:30:00Z')),
    );

    expect(result.updated).toBe(1);
    const rows = await tripRows(knex, TENANT_A);
    expect(rows).toHaveLength(2);
    const closed = rows.find((r) => r.status === 'COMPLETED');
    const active = rows.find((r) => r.status === 'ACTIVE');
    expect(closed?.started_at).toEqual(newer); // newest closed
    expect(active?.started_at).toEqual(older); // older left ACTIVE (one vehicle, one trip at a time in practice)
  });

  it('no active trip → completeTrip returns updated:0 (graceful, no throw)', async () => {
    const result = await repo.completeTrip(
      endEvent(TENANT_A, new Date('2026-08-13T10:00:00Z'), new Date('2026-08-13T10:30:00Z')),
    );
    expect(result.updated).toBe(0);
  });

  it('completeTrip is idempotent: a repeat close updates nothing and does not overwrite', async () => {
    // Models a concurrent/redelivered close (Sprint A §14). The outer
    // status='ACTIVE' guard means the second close finds nothing to update.
    const startedAt = new Date('2026-08-13T10:00:00Z');
    const firstEnd = new Date('2026-08-13T10:30:00Z');
    await repo.insertTripStart(startEvent(TENANT_A, startedAt));
    await repo.completeTrip(endEvent(TENANT_A, startedAt, firstEnd));

    // Replay with a *different* ended_at — must not overwrite the first close.
    const second = await repo.completeTrip(
      endEvent(TENANT_A, startedAt, new Date('2026-08-13T11:00:00Z')),
    );

    expect(second.updated).toBe(0);
    const row = await knex
      .withSchema('tracking')
      .from('trip_events')
      .whereRaw('tenant_id = ?::uuid', [TENANT_A])
      .whereRaw('vehicle_id = ?::uuid', [VEHICLE])
      .select('status', 'ended_at')
      .first();
    expect(row?.status).toBe('COMPLETED');
    expect(new Date(row?.ended_at).toISOString()).toBe(firstEnd.toISOString()); // untouched
  });

  it('trip completion preserves the started_at timestamp (consistent start/end)', async () => {
    const startedAt = new Date('2026-08-13T09:17:00Z');
    const endedAt = new Date('2026-08-13T10:05:00Z');
    await repo.insertTripStart(startEvent(TENANT_A, startedAt));
    await repo.completeTrip(endEvent(TENANT_A, startedAt, endedAt));

    const row = await knex
      .withSchema('tracking')
      .from('trip_events')
      .whereRaw('tenant_id = ?::uuid', [TENANT_A])
      .whereRaw('vehicle_id = ?::uuid', [VEHICLE])
      .select('started_at', 'ended_at', 'status')
      .first();
    expect(row?.status).toBe('COMPLETED');
    expect(new Date(row?.started_at).toISOString()).toBe(startedAt.toISOString()); // unchanged
    expect(new Date(row?.ended_at).toISOString()).toBe(endedAt.toISOString());
  });

  it('micro-trip → discardTrip leaves no orphan ACTIVE row', async () => {
    const startedAt = new Date('2026-08-13T10:00:00Z');
    const endedAt = new Date('2026-08-13T10:00:30Z');
    await repo.insertTripStart(startEvent(TENANT_A, startedAt));

    const result = await repo.discardTrip(discardEvent(TENANT_A, startedAt, endedAt));

    expect(result.updated).toBe(1);
    const rows = await tripRows(knex, TENANT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('DISCARDED');
  });

  it('discardTrip is idempotent: a repeat discard updates nothing', async () => {
    const startedAt = new Date('2026-08-13T10:00:00Z');
    const endedAt = new Date('2026-08-13T10:00:30Z');
    await repo.insertTripStart(startEvent(TENANT_A, startedAt));
    await repo.discardTrip(discardEvent(TENANT_A, startedAt, endedAt));

    const second = await repo.discardTrip(discardEvent(TENANT_A, startedAt, endedAt));

    expect(second.updated).toBe(0);
    const rows = await tripRows(knex, TENANT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('DISCARDED');
  });

  it('engine-hours flush → durable persistence with exact fields', async () => {
    const windowEnd = new Date('2026-08-13T10:06:41Z');
    await repo.insertEngineHours(
      ehEvent(TENANT_A, '33333333-3333-3333-3333-333333333333', 401, windowEnd),
    );

    const rows = await knex
      .withSchema('tracking')
      .from('engine_hours')
      .whereRaw('tenant_id = ?::uuid', [TENANT_A])
      .whereRaw('vehicle_id = ?::uuid', [VEHICLE]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(Number(r.duration_s)).toBe(401);
    // engine_hours is decimal(10,4); the exact value lives in duration_s (int).
    expect(Number(r.engine_hours)).toBeCloseTo(401 / 3600, 4);
    expect(r.source_event_id).toBe('33333333-3333-3333-3333-333333333333');
    expect(new Date(r.window_end).toISOString()).toBe(windowEnd.toISOString());
    expect(new Date(r.window_start).toISOString()).toBe(
      new Date(windowEnd.getTime() - 401_000).toISOString(),
    );
  });

  it('engine-hours persistence is idempotent on the source event id', async () => {
    const windowEnd = new Date('2026-08-13T10:06:41Z');
    const event = ehEvent(TENANT_A, '44444444-4444-4444-4444-444444444444', 401, windowEnd);

    await repo.insertEngineHours(event);
    await repo.insertEngineHours(event); // Kafka redelivery

    const count = await knex
      .withSchema('tracking')
      .from('engine_hours')
      .whereRaw('tenant_id = ?::uuid', [TENANT_A])
      .whereRaw('source_event_id = ?::uuid', ['44444444-4444-4444-4444-444444444444'])
      .count({ n: '*' })
      .first();
    expect(Number(count?.n ?? 0)).toBe(1);
  });

  it('tenant isolation: a completeTrip for tenant B never touches tenant A', async () => {
    await repo.insertTripStart(startEvent(TENANT_A, new Date('2026-08-13T10:00:00Z')));

    // Tenant B tries to complete a trip for the same vehicle id.
    const cross = await repo.completeTrip(
      endEvent(TENANT_B, new Date('2026-08-13T10:00:00Z'), new Date('2026-08-13T10:30:00Z')),
    );

    expect(cross.updated).toBe(0);
    const aRows = await tripRows(knex, TENANT_A);
    expect(aRows).toHaveLength(1);
    expect(aRows[0]?.status).toBe('ACTIVE'); // untouched
    const bRows = await tripRows(knex, TENANT_B);
    expect(bRows).toHaveLength(0);
  });
});

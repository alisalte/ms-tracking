/**
 * Sprint F §26 — performance verification with EXPLAIN against a real
 * TimescaleDB+PostGIS instance.
 *
 * Seeds a bounded position set for two tenants and asserts the four hot query
 * shapes avoid sequential scans on the hypertable:
 *   1. latest-per-vehicle        (ix_positions_tenant_vehicle_time)
 *   2. historical track range    (ix_positions_tenant_vehicle_time)
 *   3. nearby (ST_DWithin)       (ix_positions_geom_gist — Sprint F)
 *   4. in-bounds (bbox &&)       (ix_positions_geom_gist — Sprint F)
 *
 * Gracefully skips when the docker Postgres is unreachable (pnpm test stays
 * green without Docker; CI runs it for real).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PositionEvent } from '../../domain/position-event.js';
import { PositionRepository } from '../../infrastructure/persistence/position.repository.js';
import { type IntegrationCtx, bootstrap, dropTestDb } from './db.js';

const DB = `gps_sprintf_explain_${Date.now().toString(36)}`;
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const VEHICLE_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const VEHICLE_B = 'aaaaaaaa-0000-4000-8000-000000000002';

let ctx: IntegrationCtx | null = null;

beforeAll(async () => {
  ctx = await bootstrap(DB);
  if (!ctx) return;
  const repo = new PositionRepository(ctx.knex);
  const base = Date.now();
  let _i = 0;
  for (const tenant of [TENANT_A, TENANT_B]) {
    for (const vehicle of [VEHICLE_A, VEHICLE_B]) {
      for (let k = 0; k < 50; k++) {
        _i += 1;
        await repo.insert(
          new PositionEvent({
            messageId: crypto.randomUUID(),
            tenantId: tenant,
            vehicleId: vehicle,
            capturedAt: new Date(base - k * 60_000),
            ingestedAt: new Date(),
            latitude: 35.7 + (tenant === TENANT_A ? 0 : 5) + k * 0.0001,
            longitude: 51.4 + (tenant === TENANT_A ? 0 : 5) + k * 0.0001,
            speedKph: 30,
            headingDeg: 90,
            altitudeM: null,
            ignitionOn: true,
            quality: 'VALID',
            protocolId: 'gt06',
            satellites: 10,
          }),
        );
      }
    }
  }
}, 60_000);

afterAll(async () => {
  if (!ctx) return;
  await ctx.knex.destroy();
  await dropTestDb(ctx.admin, DB);
  await ctx.admin.destroy();
});

/** True when the plan mentions a sequential scan on the hypertable. */
async function planFor(sql: string, bindings: unknown[]): Promise<string> {
  const res = await ctx?.knex.raw(`EXPLAIN (COSTS OFF) ${sql}`, bindings);
  return res.rows.map((r: Record<string, unknown>) => Object.values(r)[0]).join('\n');
}

describe('Sprint F spatial query plans (EXPLAIN)', () => {
  it('skips when Postgres is unreachable', () => {
    if (!ctx) return;
  });

  it('latest-per-vehicle uses the tenant/time index, not a seq scan', async () => {
    if (!ctx) return;
    const repo = new PositionRepository(ctx.knex);
    await repo.findLatestForTenant(TENANT_A, 10); // warm
    const plan = await planFor(
      'SELECT DISTINCT ON (vehicle_id) * FROM tracking.vehicle_positions WHERE tenant_id = ?::uuid ORDER BY vehicle_id DESC, captured_at DESC LIMIT 10',
      [TENANT_A],
    );
    expect(plan).not.toMatch(/Seq Scan on .*vehicle_positions/);
  });

  it('historical track range uses the tenant/vehicle/time index', async () => {
    if (!ctx) return;
    const plan = await planFor(
      `SELECT * FROM tracking.vehicle_positions
       WHERE tenant_id = ?::uuid AND vehicle_id = ?::uuid
         AND captured_at >= ? AND captured_at <= ?
       ORDER BY captured_at ASC LIMIT 1000`,
      [TENANT_A, VEHICLE_A, new Date(0), new Date()],
    );
    expect(plan).not.toMatch(/Seq Scan on .*vehicle_positions/);
  });

  it('nearby (ST_DWithin) uses the GiST spatial index', async () => {
    if (!ctx) return;
    const point = 'SRID=4326;POINT(51.4 35.7)';
    const plan = await planFor(
      `SELECT * FROM tracking.vehicle_positions
       WHERE tenant_id = ?::uuid AND ST_DWithin(geom, ?::geography, 1000)`,
      [TENANT_A, point],
    );
    expect(plan).toMatch(
      /Index Scan.*using ix_positions_geom_gist|Bitmap Index Scan.*ix_positions_geom_gist/,
    );
  });

  it('in-bounds (&&) uses the GiST spatial index', async () => {
    if (!ctx) return;
    const bbox = 'SRID=4326;POLYGON((51.3 35.6,51.5 35.6,51.5 35.8,51.3 35.8,51.3 35.6))';
    const plan = await planFor(
      `SELECT * FROM tracking.vehicle_positions
       WHERE tenant_id = ?::uuid AND geom && ?::geography`,
      [TENANT_A, bbox],
    );
    expect(plan).toMatch(
      /Index Scan.*using ix_positions_geom_gist|Bitmap Index Scan.*ix_positions_geom_gist/,
    );
  });

  it('the GIST index exists on the hypertable', async () => {
    if (!ctx) return;
    const res = await ctx.knex.raw(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'tracking' AND tablename = 'vehicle_positions'`,
    );
    const names = res.rows.map((r: { indexname: string }) => r.indexname);
    expect(names).toContain('ix_positions_geom_gist');
    expect(names).toContain('ix_positions_tenant_vehicle_time');
  });
});

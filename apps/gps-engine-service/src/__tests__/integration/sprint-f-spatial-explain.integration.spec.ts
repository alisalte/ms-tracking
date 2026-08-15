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
  // Bulk-seed a REALISTIC volume via generate_series (Sprint G G-0 finding:
  // the original 200-row seed made the planner legitimately prefer Seq Scans —
  // GiST index usage only wins on non-trivial tables). 5,000 positions across
  // two tenants/two vehicles. Points are SPREAD over a wide area (±2°) so the
  // nearby/in-bounds probes match a small fraction of rows — the realistic
  // selectivity that makes the GiST index the genuinely cheapest plan.
  await ctx.knex.raw(
    `INSERT INTO tracking.vehicle_positions
       (event_id, vehicle_id, tenant_id, captured_at, ingested_at, geom,
        latitude, longitude, altitude_m, heading_deg, speed_kmh, ignition_on, quality, metadata)
     SELECT
       gen_random_uuid(),
       (ARRAY['${VEHICLE_A}'::uuid, '${VEHICLE_B}'::uuid])[1 + (g % 2)],
       (ARRAY['${TENANT_A}'::uuid, '${TENANT_B}'::uuid])[1 + (g % 2)],
       now() - (g || ' seconds')::interval,
       now(),
       ST_SetSRID(ST_MakePoint(
         51.4 + (CASE WHEN g % 2 = 0 THEN 0 ELSE 5 END) + (random() - 0.5) * 4,
         35.7 + (CASE WHEN g % 2 = 0 THEN 0 ELSE 5 END) + (random() - 0.5) * 4
       ), 4326)::geography,
       35.7 + (CASE WHEN g % 2 = 0 THEN 0 ELSE 5 END) + (random() - 0.5) * 4,
       51.4 + (CASE WHEN g % 2 = 0 THEN 0 ELSE 5 END) + (random() - 0.5) * 4,
       NULL, 90, 30, true, 1, '{"protocolId":"gt06"}'::jsonb
     FROM generate_series(0, 4999) AS g`,
  );
  await ctx.knex.raw('ANALYZE tracking.vehicle_positions');
}, 120_000);

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
      // Chunk indexes carry the TimescaleDB chunk prefix (e.g.
      // _hyper_1_1_chunk_ix_positions_geom_gist) — match the suffix.
      /Index Scan.*using \S*ix_positions_geom_gist|Bitmap Index Scan.*\S*ix_positions_geom_gist/,
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
      /Index Scan.*using \S*ix_positions_geom_gist|Bitmap Index Scan.*\S*ix_positions_geom_gist/,
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

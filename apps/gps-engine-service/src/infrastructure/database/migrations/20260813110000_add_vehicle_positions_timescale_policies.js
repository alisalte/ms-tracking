/**
 * Sprint A — TimescaleDB compression + retention for vehicle_positions
 * (03 §11.1/§11.2; 07 §9.3/§9.5).
 *
 * `tracking.vehicle_positions` was made a hypertable (1-day chunks) in the
 * Sprint 7 position migration, but no compression or retention policy was
 * attached — so the append-only time-series grew unbounded. This migration adds
 * both, matching the source-of-truth DDL in docs/specs/03_Database_Architecture
 * §11.1:
 *
 *   ALTER TABLE ... SET (timescaledb.compress,
 *                        compress_segmentby = 'vehicle_id',
 *                        compress_orderby   = 'captured_at DESC');
 *   add_compression_policy(..., INTERVAL '7 days');
 *   add_retention_policy (..., INTERVAL '180 days');
 *
 * Configurability: the intervals default to the spec's 7d / 180d but honor the
 * GPS_POSITIONS_COMPRESS_AFTER_DAYS / GPS_POSITIONS_RETENTION_DAYS env vars when
 * present (validated to a positive integer; the inlined value is coerced, so it
 * is injection-safe). The intervals are applied at first run; changing them
 * later requires `alter_job` or a follow-up migration (a migration does not
 * re-run once recorded in schema_migrations).
 *
 * RLS prerequisite: TimescaleDB columnar compression is incompatible with
 * Row-Level Security ("columnstore cannot be used on table with row security").
 * The Sprint 7 migration attached a *permissive* (USING true / WITH CHECK true)
 * RLS policy to vehicle_positions as an MVP stub — it enforces no real tenant
 * isolation (every query already filters by tenant_id at the repository layer).
 * This migration drops that stub + disables RLS so the required compression
 * policy can apply, restoring the stub in down(). Genuine tenant isolation for
 * the hypertable is a later cross-cutting concern (it cannot use both RLS and
 * compression simultaneously).
 *
 * Idempotency: the ALTER TABLE is inherently idempotent; add_*_policy use
 * `if_not_exists => TRUE`, so the migration is safe to apply even if a policy
 * was created out-of-band. Validated against TimescaleDB 2.29 (the version in
 * the `timescale/timescaledb-ha:pg16` Docker image); `if_not_exists` for these
 * policy functions has shipped since TimescaleDB 2.0.
 *
 * @param {import("knex").Knex} knex
 */

/** Parse env to a positive integer, falling back to `fallback` when unset/invalid. */
function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function up(knex) {
  const compressAfterDays = positiveIntEnv('GPS_POSITIONS_COMPRESS_AFTER_DAYS', 7);
  const retentionDays = positiveIntEnv('GPS_POSITIONS_RETENTION_DAYS', 180);

  // Drop the permissive RLS stub + disable RLS: a prerequisite for compression
  // (TimescaleDB rejects columnstore on a table with row security enabled).
  await knex.raw(
    'DROP POLICY IF EXISTS vehicle_positions_tenant_isolation ON tracking.vehicle_positions',
  );
  await knex.raw('ALTER TABLE tracking.vehicle_positions DISABLE ROW LEVEL SECURITY');

  // Columnar compression: segment-by vehicle_id (per-vehicle range scans),
  // order-by captured_at DESC. ~90% storage reduction (03 §11.2). Idempotent.
  await knex.raw(`
    ALTER TABLE tracking.vehicle_positions SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'vehicle_id',
      timescaledb.compress_orderby = 'captured_at DESC'
    )
  `);

  // Compress chunks older than N days (background job). if_not_exists => re-run safe.
  await knex.raw(
    `SELECT add_compression_policy('tracking.vehicle_positions', INTERVAL '${compressAfterDays} days', if_not_exists => TRUE)`,
  );

  // Drop chunks older than N days (background job). if_not_exists => re-run safe.
  await knex.raw(
    `SELECT add_retention_policy('tracking.vehicle_positions', INTERVAL '${retentionDays} days', if_not_exists => TRUE)`,
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(
    `SELECT remove_compression_policy('tracking.vehicle_positions', if_exists => TRUE)`,
  );
  await knex.raw(`SELECT remove_retention_policy('tracking.vehicle_positions', if_exists => TRUE)`);
  // Unset compression. Compressed chunks (if any) are decompressed by Timescale.
  await knex.raw('ALTER TABLE tracking.vehicle_positions SET (timescaledb.compress = false)');
  // Restore the permissive RLS stub removed in up().
  await knex.raw('ALTER TABLE tracking.vehicle_positions ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    'CREATE POLICY vehicle_positions_tenant_isolation ON tracking.vehicle_positions USING (true) WITH CHECK (true)',
  );
}

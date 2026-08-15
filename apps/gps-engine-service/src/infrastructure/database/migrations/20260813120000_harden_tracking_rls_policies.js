/**
 * Sprint B — harden RLS policies on the tracking projection tables
 * (`tracking.device_status`, `tracking.trip_events`, `tracking.idle_periods`,
 * `tracking.parking_periods`, `tracking.engine_hours`) from the permissive
 * `USING (true) WITH CHECK (true)` stub to a real, fail-closed tenant predicate.
 *
 * IMPORTANT:
 *  - `tracking.vehicle_positions` is deliberately NOT touched. It is a
 *    TimescaleDB hypertable whose RLS Sprint A dropped to enable compression
 *    (Timescale forbids compression + RLS). Its tenant isolation stays at the
 *    repository layer (`PositionRepository` filters by `tenant_id`).
 *  - As with the iam schema, the app connects as the `fleetvision` owner/
 *    superuser, so RLS is BYPASSED today. These hardened policies are
 *    forward-ready (effective once a non-superuser app role is introduced);
 *    the repository-layer `WHERE tenant_id = ?` is the enforcing boundary now.
 *
 * Predicate: fail CLOSED when `app.current_tenant_id` is unset.
 *
 * @param {import("knex").Knex} knex
 */
const PREDICATE = "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";

const TABLES = [
  'tracking.device_status',
  'tracking.trip_events',
  'tracking.idle_periods',
  'tracking.parking_periods',
  'tracking.engine_hours',
];

export const up = async function up(knex) {
  for (const qualified of TABLES) {
    const [schema, table] = qualified.split('.');
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${schema}"."${table}"`);
    await knex.raw(
      `CREATE POLICY "${table}_tenant_isolation" ON "${schema}"."${table}" USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
    );
  }
};

export const down = async function down(knex) {
  for (const qualified of TABLES) {
    const [schema, table] = qualified.split('.');
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${schema}"."${table}"`);
    await knex.raw(
      `CREATE POLICY "${table}_tenant_isolation" ON "${schema}"."${table}" USING (true) WITH CHECK (true)`,
    );
  }
};

/**
 * Sprint I — extend `tracking.geofences` for the full CRUD lifecycle and add
 * the `tracking.geofence_vehicles` assignment table.
 *
 * Geofence lifecycle (Sprint I §5/§17):
 *   - `description`  — optional human description.
 *   - `status`       — ACTIVE | INACTIVE | ARCHIVED. Only ACTIVE geofences are
 *                      evaluated by the GPS Engine. ARCHIVED is the soft-delete
 *                      target of `DELETE /geofences/:id` so historical alarm /
 *                      FleetEvent references stay resolvable (Sprint I §10).
 *   - `created_by`   — audit attribution (from the verified JWT principal).
 *
 * Assignment (Sprint I §16): `tracking.geofence_vehicles` is a many-to-many
 * vehicle ↔ geofence link. A geofence with NO assignments applies to every
 * vehicle in the tenant (legacy Sprint F/G semantics — preserved so existing
 * fences keep firing); a geofence WITH assignments is restricted to the
 * assigned vehicles.
 *
 * Indexes: PK (geofence_id, vehicle_id) for membership checks, plus
 * (tenant_id, vehicle_id) to answer "which fences apply to this vehicle".
 *
 * RLS follows the house pattern: ENABLE + strict tenant predicate
 * (`tenant_id = current_setting('app.current_tenant_id')`), forward-ready —
 * the app currently connects as the table owner, so the repository-layer
 * `WHERE tenant_id` remains the enforcing boundary (see the Sprint B hardening
 * notes in 20260813120000).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.schema.withSchema('tracking').alterTable('geofences', (t) => {
    t.text('description').nullable();
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.uuid('created_by').nullable();
  });
  await knex.raw('ALTER TABLE tracking.geofences DROP CONSTRAINT IF EXISTS geofences_status_check');
  await knex.raw(
    "ALTER TABLE tracking.geofences ADD CONSTRAINT geofences_status_check CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED'))",
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ix_geofences_tenant_status ON tracking.geofences (tenant_id, status)',
  );

  await knex.schema.withSchema('tracking').createTable('geofence_vehicles', (t) => {
    t.uuid('geofence_id').notNullable();
    t.uuid('vehicle_id').notNullable();
    t.uuid('tenant_id').notNullable();
    t.timestamp('assigned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('assigned_by').nullable();
    t.primary(['geofence_id', 'vehicle_id']);
  });
  await knex.raw(
    'CREATE INDEX ix_geofence_vehicles_tenant_vehicle ON tracking.geofence_vehicles (tenant_id, vehicle_id)',
  );
  await knex.raw('ALTER TABLE tracking.geofence_vehicles ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    "CREATE POLICY geofence_vehicles_tenant_isolation ON tracking.geofence_vehicles USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)",
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(
    'DROP POLICY IF EXISTS geofence_vehicles_tenant_isolation ON tracking.geofence_vehicles',
  );
  await knex.schema.withSchema('tracking').dropTableIfExists('geofence_vehicles');
  await knex.raw('DROP INDEX IF EXISTS tracking.ix_geofences_tenant_status');
  await knex.raw('ALTER TABLE tracking.geofences DROP CONSTRAINT IF EXISTS geofences_status_check');
  await knex.schema.withSchema('tracking').alterTable('geofences', (t) => {
    t.dropColumn('description');
    t.dropColumn('status');
    t.dropColumn('created_by');
  });
}

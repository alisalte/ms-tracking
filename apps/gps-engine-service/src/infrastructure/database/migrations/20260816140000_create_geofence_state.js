/**
 * Sprint I — geofence evaluation state for the GPS Engine.
 *
 * `tracking.geofence_state` persists the per-(tenant, vehicle, geofence)
 * membership FSM (Sprint I §23): worker restarts MUST NOT cause duplicate
 * ENTER/EXIT/DWELL events, so PostgreSQL — not process memory — is the
 * authoritative state store (Redis is not used for this: FSM snapshots there
 * are best-effort hints, this state must survive restarts deterministically).
 *
 * States: OUTSIDE → CANDIDATE_IN → INSIDE → CANDIDATE_OUT → OUTSIDE.
 *   - CANDIDATE_IN  : consecutive contained observations being counted
 *                     (jitter protection — GEOFENCE_CONFIRMATION_POINTS).
 *   - INSIDE        : ENTER confirmed; entered_at anchors the DWELL window.
 *   - CANDIDATE_OUT : consecutive non-contained observations being counted.
 *
 * confirm_count carries the consecutive-observation counter; dwell_fired_at
 * marks the occupancy period whose DWELL event already fired (at most one per
 * occupancy unless the vehicle exits and re-enters — Sprint I §22).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.schema.withSchema('tracking').createTable('geofence_state', (t) => {
    t.uuid('tenant_id').notNullable();
    t.uuid('vehicle_id').notNullable();
    t.uuid('geofence_id').notNullable();
    t.text('state').notNullable().defaultTo('OUTSIDE');
    t.integer('confirm_count').notNullable().defaultTo(0);
    t.timestamp('entered_at', { useTz: true }).nullable();
    t.timestamp('dwell_fired_at', { useTz: true }).nullable();
    t.timestamp('last_seen_at', { useTz: true }).nullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant_id', 'vehicle_id', 'geofence_id']);
  });
  await knex.raw(
    'ALTER TABLE tracking.geofence_state DROP CONSTRAINT IF EXISTS geofence_state_state_check',
  );
  await knex.raw(
    "ALTER TABLE tracking.geofence_state ADD CONSTRAINT geofence_state_state_check CHECK (state IN ('OUTSIDE','CANDIDATE_IN','INSIDE','CANDIDATE_OUT'))",
  );
  await knex.raw(
    'CREATE INDEX ix_geofence_state_tenant_vehicle ON tracking.geofence_state (tenant_id, vehicle_id)',
  );
  // Rows where the geofence disappeared (deleted/archived) are reset lazily by
  // the evaluator; a periodic prune keeps the table bounded.
  await knex.raw('CREATE INDEX ix_geofence_state_updated ON tracking.geofence_state (updated_at)');
  await knex.raw('ALTER TABLE tracking.geofence_state ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    "CREATE POLICY geofence_state_tenant_isolation ON tracking.geofence_state USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)",
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(
    'DROP POLICY IF EXISTS geofence_state_tenant_isolation ON tracking.geofence_state',
  );
  await knex.schema.withSchema('tracking').dropTableIfExists('geofence_state');
}

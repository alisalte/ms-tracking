/**
 * Sprint G — FleetEvent history (SPRINT-G Part 35).
 *
 * The alarm engine consumes gps-engine FleetEvents (trip/idle/parking
 * boundaries + device-status transitions) off the tracking.events topic. This
 * table is the bounded, idempotent event log backing GET /api/v1/notification/events:
 *   - id IS the deterministic Kafka eventId (`<sourceEventId>:<eventType>`) —
 *     a redelivered message INSERTs ON CONFLICT DO NOTHING (Part 6).
 *   - It does NOT duplicate the alarm table: alarms are rule-triggered
 *     occurrences; this is the raw detection history. Position-derived
 *     detections (speeding/geofence) are NOT double-stored here — they are
 *     represented by their alarms (and full positions live in the gps-engine
 *     hypertable).
 *
 * Tenant-scoped with hardened RLS, matching the notification-schema pattern.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.schema.withSchema('notification').createTable('fleet_events', (t) => {
    // Deterministic eventId — the idempotency key (NOT a random UUID).
    t.text('id').primary();
    t.uuid('tenant_id').notNullable();
    t.uuid('vehicle_id').nullable();
    t.uuid('device_id').nullable();
    // trip.started | trip.ended | idle.* | parking.* | device.online/offline/stale
    t.text('event_type').notNullable();
    t.timestamp('occurred_at', { useTz: true }).notNullable();
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('severity').nullable();
    t.jsonb('metadata').notNullable().defaultTo(JSON.stringify({}));
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_fleet_events_tenant_time ON notification.fleet_events (tenant_id, occurred_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_fleet_events_tenant_vehicle ON notification.fleet_events (tenant_id, vehicle_id, occurred_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_fleet_events_tenant_type ON notification.fleet_events (tenant_id, event_type, occurred_at DESC)',
  );

  // ── Row-Level Security (hardened pattern) ──
  await knex.raw('ALTER TABLE notification.fleet_events ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE notification.fleet_events FORCE ROW LEVEL SECURITY');
  await knex.raw(
    'DROP POLICY IF EXISTS "fleet_events_tenant_isolation" ON notification.fleet_events',
  );
  await knex.raw(`
    CREATE POLICY "fleet_events_tenant_isolation" ON notification.fleet_events
      USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
      )
      WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
      )
  `);
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON notification.fleet_events TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(
    'DROP POLICY IF EXISTS "fleet_events_tenant_isolation" ON notification.fleet_events',
  );
  await knex.schema.withSchema('notification').dropTableIfExists('fleet_events');
}

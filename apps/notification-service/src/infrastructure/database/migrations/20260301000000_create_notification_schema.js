/**
 * Sprint 4 — Alarm Engine schema (12_Alarm_Engine.md §6).
 *
 * Creates the `notification` schema with three tables:
 *   - notification.alert_rules          — rule definitions (what to detect).
 *   - notification.alerts               — raised alarm occurrences (lifecycle).
 *   - notification.alert_acknowledgements — audit trail of ack/resolve transitions.
 *
 * All tables are tenant-scoped with hardened RLS (FORCE + tenant_id policy),
 * matching the Sprint 1/2 pattern. Grants to fleetvision_app + fleetvision_platform.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS notification');

  // ── notification.alert_rules ──
  await knex.schema.withSchema('notification').createTable('alert_rules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.string('name', 256).notNullable();
    // Extensible type union — checkIn validates at the DB level.
    t.text('type')
      .notNullable()
      .checkIn([
        'overspeed',
        'ignition_on',
        'ignition_off',
        'prolonged_idle',
        'parking',
        'device_offline',
        'low_battery',
        'geofence_enter',
        'geofence_exit',
        'geofence_dwell',
        'trip_started',
        'trip_ended',
        'excessive_trip_duration',
        'excessive_stop_duration',
      ]);
    t.text('severity').notNullable().checkIn(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    t.boolean('enabled').notNullable().defaultTo(true);
    t.text('entity_type').notNullable().defaultTo('vehicle');
    // entity_id is null = applies to ALL vehicles in the tenant.
    t.uuid('entity_id').nullable();
    // Threshold/params as JSONB — each rule type interprets these.
    t.jsonb('conditions').notNullable().defaultTo(JSON.stringify({}));
    t.integer('cooldown_sec').notNullable().defaultTo(300);
    t.integer('dedup_window_sec').notNullable().defaultTo(600);
    t.text('repeat_policy')
      .notNullable()
      .checkIn(['ALWAYS', 'ONCE', 'COOLDOWN'])
      .defaultTo('COOLDOWN');
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_alert_rules_tenant_enabled ON notification.alert_rules (tenant_id, enabled)',
  );
  await knex.raw(
    'CREATE INDEX ix_alert_rules_tenant_type ON notification.alert_rules (tenant_id, type)',
  );

  // ── notification.alerts ──
  await knex.schema.withSchema('notification').createTable('alerts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('rule_id').notNullable();
    t.text('type').notNullable();
    t.text('severity').notNullable().checkIn(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    t.text('status').notNullable().checkIn(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).defaultTo('OPEN');
    t.uuid('vehicle_id').nullable();
    t.double('lat').nullable();
    t.double('lng').nullable();
    t.text('message').notNullable();
    t.jsonb('detail').notNullable().defaultTo(JSON.stringify({}));
    t.jsonb('source_events').notNullable().defaultTo(JSON.stringify([]));
    t.timestamp('raised_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('acknowledged_at', { useTz: true }).nullable();
    t.uuid('acknowledged_by').nullable();
    t.timestamp('resolved_at', { useTz: true }).nullable();
    t.uuid('resolved_by').nullable();
    t.text('resolution_reason').nullable();
    // Optimistic-concurrency version (the repository updates with
    // WHERE version = <loaded> and version = version + 1 — Sprint G Part 12).
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_alerts_tenant_status ON notification.alerts (tenant_id, status, raised_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_alerts_tenant_vehicle ON notification.alerts (tenant_id, vehicle_id, raised_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_alerts_tenant_severity ON notification.alerts (tenant_id, severity, raised_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_alerts_tenant_rule ON notification.alerts (tenant_id, rule_id, raised_at DESC)',
  );

  // ── notification.alert_acknowledgements ──
  await knex.schema.withSchema('notification').createTable('alert_acknowledgements', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('alert_id').notNullable();
    t.text('action').notNullable().checkIn(['ACKNOWLEDGE', 'RESOLVE']);
    t.uuid('actor_id').nullable();
    t.text('reason').nullable();
    t.text('previous_status').notNullable();
    t.text('new_status').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_alert_ack_alert ON notification.alert_acknowledgements (tenant_id, alert_id, created_at DESC)',
  );

  // ── Row-Level Security (hardened pattern) ──
  const tables = ['alert_rules', 'alerts', 'alert_acknowledgements'];
  for (const table of tables) {
    await knex.raw(`ALTER TABLE notification."${table}" ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`ALTER TABLE notification."${table}" FORCE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON notification."${table}"`);
    await knex.raw(`
      CREATE POLICY "${table}_tenant_isolation" ON notification."${table}"
        USING (
          tenant_id = current_setting('app.current_tenant_id', true)::uuid
          OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
        )
        WITH CHECK (
          tenant_id = current_setting('app.current_tenant_id', true)::uuid
          OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
        )
    `);
  }

  // ── Grants for the new schema ──
  await knex.raw('GRANT USAGE ON SCHEMA notification TO fleetvision_app, fleetvision_platform');
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  for (const table of ['alert_acknowledgements', 'alerts', 'alert_rules']) {
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON notification."${table}"`);
    await knex.schema.withSchema('notification').dropTableIfExists(table);
  }
  await knex.raw('DROP SCHEMA IF EXISTS notification');
}

/**
 * Sprint 5 — Notification delivery tier tables.
 *
 * Adds three tables to the existing `notification` schema (created in Sprint 4):
 *   - notification.notifications           — in-app notification records (the bell).
 *   - notification.notification_preferences — per-user channel + severity prefs.
 *   - notification.notification_deliveries  — delivery audit trail with retry.
 *
 * All tables are tenant-scoped with hardened RLS.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  // ── notification.notifications ──
  await knex.schema.withSchema('notification').createTable('notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    // user_id null = broadcast to all tenant users.
    t.uuid('user_id').nullable();
    t.text('category')
      .notNullable()
      .checkIn(['alarm', 'trip', 'maintenance', 'compliance', 'system', 'billing']);
    t.text('severity').notNullable().checkIn(['critical', 'high', 'normal', 'low']);
    t.string('title', 256).notNullable();
    t.text('body').notNullable();
    t.text('link').nullable();
    t.boolean('read').notNullable().defaultTo(false);
    t.timestamp('read_at', { useTz: true }).nullable();
    // Idempotency: source_type + source_id uniquely identifies the originating event.
    t.text('source_type').notNullable();
    t.uuid('source_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  // Idempotency: one notification per source event per user.
  await knex.raw(
    'CREATE UNIQUE INDEX ux_notifications_source ON notification.notifications (tenant_id, user_id, source_type, source_id)',
  );
  await knex.raw(
    'CREATE INDEX ix_notifications_unread ON notification.notifications (tenant_id, user_id, read, created_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_notifications_user ON notification.notifications (tenant_id, user_id, created_at DESC)',
  );

  // ── notification.notification_preferences ──
  await knex.schema.withSchema('notification').createTable('notification_preferences', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('user_id').notNullable();
    t.text('category').notNullable();
    t.text('min_severity')
      .notNullable()
      .checkIn(['critical', 'high', 'normal', 'low'])
      .defaultTo('normal');
    t.jsonb('channels')
      .notNullable()
      .defaultTo(JSON.stringify(['websocket', 'in_app']));
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE UNIQUE INDEX ux_notif_prefs_user_cat ON notification.notification_preferences (tenant_id, user_id, category)',
  );

  // ── notification.notification_deliveries ──
  await knex.schema.withSchema('notification').createTable('notification_deliveries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('notification_id').notNullable();
    t.text('channel')
      .notNullable()
      .checkIn(['websocket', 'in_app', 'email', 'sms', 'push', 'webhook']);
    t.text('status')
      .notNullable()
      .checkIn(['PENDING', 'SENT', 'FAILED', 'READ'])
      .defaultTo('PENDING');
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('error').nullable();
    t.timestamp('sent_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_deliveries_notif ON notification.notification_deliveries (tenant_id, notification_id)',
  );
  await knex.raw(
    'CREATE INDEX ix_deliveries_status ON notification.notification_deliveries (tenant_id, status, channel)',
  );

  // ── RLS (hardened pattern) ──
  const tables = ['notifications', 'notification_preferences', 'notification_deliveries'];
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

  // ── Grants ──
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  for (const table of ['notification_deliveries', 'notification_preferences', 'notifications']) {
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON notification."${table}"`);
    await knex.schema.withSchema('notification').dropTableIfExists(table);
  }
}

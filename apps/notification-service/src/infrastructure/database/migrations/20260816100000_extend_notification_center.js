/**
 * Sprint H — Notification Center extension.
 *
 * Extends the Sprint 5 notification tables:
 *   - notification.notifications:
 *       + event_type   (alarm/event type: overspeed, geofence_enter, …)
 *       + vehicle_id   (vehicle context for history filters)
 *       + metadata     (whitelisted template context, jsonb)
 *       + priority     (low|normal|high|urgent — derived from severity)
 *       + indexes for type/vehicle history filters
 *   - notification.notification_deliveries:
 *       + next_attempt_at    (durable retry scheduling — replaces in-memory
 *                              setTimeout retry, survives restarts)
 *       + provider           (provider name for the attempt)
 *       + provider_message_id (provider reference id)
 *       + error_code         (PERMANENT|TRANSIENT classification)
 *       + status gains DELIVERED (provider-confirmed delivery only)
 *       + index for the retry sweeper claim query
 *
 * Forward-only, deterministic. RLS already covers both tables.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  // ── notification.notifications ──
  await knex.schema.withSchema('notification').alterTable('notifications', (t) => {
    t.string('event_type', 64).notNullable().defaultTo('system');
    t.uuid('vehicle_id').nullable();
    t.jsonb('metadata').notNullable().defaultTo(JSON.stringify({}));
    t.string('priority', 16)
      .notNullable()
      .checkIn(['low', 'normal', 'high', 'urgent'])
      .defaultTo('normal');
  });
  await knex.raw(
    'CREATE INDEX ix_notifications_event_type ON notification.notifications (tenant_id, event_type, created_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_notifications_vehicle ON notification.notifications (tenant_id, vehicle_id, created_at DESC)',
  );

  // ── notification.notification_deliveries ──
  // Widen the status check to include DELIVERED.
  await knex.raw(
    'ALTER TABLE notification.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_status_check',
  );
  await knex.raw(`
    ALTER TABLE notification.notification_deliveries
      ADD CONSTRAINT notification_deliveries_status_check
      CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ'))
  `);
  await knex.schema.withSchema('notification').alterTable('notification_deliveries', (t) => {
    t.timestamp('next_attempt_at', { useTz: true }).nullable();
    t.string('provider', 32).nullable();
    t.text('provider_message_id').nullable();
    t.string('error_code', 64).nullable();
  });
  // Retry sweeper claim index: due PENDING deliveries per tenant.
  await knex.raw(
    'CREATE INDEX ix_deliveries_retry ON notification.notification_deliveries (tenant_id, status, next_attempt_at)',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS notification.ix_deliveries_retry');
  await knex.schema.withSchema('notification').alterTable('notification_deliveries', (t) => {
    t.dropColumns('next_attempt_at', 'provider', 'provider_message_id', 'error_code');
  });
  await knex.raw(
    'ALTER TABLE notification.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_status_check',
  );
  await knex.raw(`
    ALTER TABLE notification.notification_deliveries
      ADD CONSTRAINT notification_deliveries_status_check
      CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'READ'))
  `);
  await knex.raw('DROP INDEX IF EXISTS notification.ix_notifications_vehicle');
  await knex.raw('DROP INDEX IF EXISTS notification.ix_notifications_event_type');
  await knex.schema.withSchema('notification').alterTable('notifications', (t) => {
    t.dropColumns('event_type', 'vehicle_id', 'metadata', 'priority');
  });
}

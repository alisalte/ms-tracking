/**
 * Phase 1 / F-07 Slice 1 — alarm evidence metadata + platform photo store.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  const exists = await knex.schema.withSchema('notification').hasTable('alarm_evidence');
  if (exists) return;

  await knex.schema.withSchema('notification').createTable('alarm_evidence', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('alert_id').notNullable();
    t.uuid('device_id').notNullable();
    t.uuid('vehicle_id').nullable();
    t.text('alarm_type').notNullable();
    t.text('status').notNullable().checkIn([
      'PENDING',
      'FETCHING',
      'PHOTO_READY',
      'PHOTO_MISSING',
      'PHOTO_FAILED',
      'SKIPPED_COOLDOWN',
    ]);
    t.text('photo_name').nullable();
    t.binary('photo_bytes').nullable();
    t.text('photo_content_type').nullable();
    t.uuid('command_id').nullable();
    t.text('error').nullable();
    t.timestamp('video_window_from', { useTz: true }).nullable();
    t.timestamp('video_window_to', { useTz: true }).nullable();
    t.text('video_object_key').nullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    'CREATE UNIQUE INDEX ux_alarm_evidence_alert ON notification.alarm_evidence (alert_id)',
  );
  await knex.raw(
    'CREATE INDEX ix_alarm_evidence_cooldown ON notification.alarm_evidence (tenant_id, device_id, alarm_type, created_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_alarm_evidence_pending ON notification.alarm_evidence (status, created_at ASC) WHERE status = \'PENDING\'',
  );
  await knex.raw(
    'CREATE INDEX ix_alarm_evidence_expires ON notification.alarm_evidence (expires_at)',
  );
  await knex.raw(
    'CREATE INDEX ix_alarm_evidence_command ON notification.alarm_evidence (command_id) WHERE command_id IS NOT NULL',
  );

  await knex.raw(`ALTER TABLE notification.alarm_evidence ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE notification.alarm_evidence FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS "alarm_evidence_tenant_isolation" ON notification.alarm_evidence`);
  await knex.raw(`
    CREATE POLICY "alarm_evidence_tenant_isolation" ON notification.alarm_evidence
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
    'GRANT SELECT, INSERT, UPDATE, DELETE ON notification.alarm_evidence TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(`DROP POLICY IF EXISTS "alarm_evidence_tenant_isolation" ON notification.alarm_evidence`);
  await knex.schema.withSchema('notification').dropTableIfExists('alarm_evidence');
}

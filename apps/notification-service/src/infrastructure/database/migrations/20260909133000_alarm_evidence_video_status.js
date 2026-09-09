/**
 * F-07 Slice 2 — video status columns + independent video job tracking.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  const has = await knex.schema.withSchema('notification').hasTable('alarm_evidence');
  if (!has) return;

  const hasVideoStatus = await knex.schema
    .withSchema('notification')
    .hasColumn('alarm_evidence', 'video_status');
  if (!hasVideoStatus) {
    await knex.schema.withSchema('notification').alterTable('alarm_evidence', (t) => {
      t.text('video_status').nullable();
      t.integer('video_channel').nullable();
      t.uuid('video_command_id').nullable();
    });
  }

  // Backfill: rows with a window and no cooldown skip → PENDING video.
  await knex.raw(`
    UPDATE notification.alarm_evidence
       SET video_status = CASE
             WHEN status = 'SKIPPED_COOLDOWN' THEN 'SKIPPED'
             WHEN video_window_from IS NOT NULL THEN 'PENDING'
             ELSE NULL
           END
     WHERE video_status IS NULL
  `);

  await knex.raw(`
    ALTER TABLE notification.alarm_evidence
      DROP CONSTRAINT IF EXISTS alarm_evidence_video_status_check
  `);
  await knex.raw(`
    ALTER TABLE notification.alarm_evidence
      ADD CONSTRAINT alarm_evidence_video_status_check
      CHECK (
        video_status IS NULL
        OR video_status IN ('PENDING', 'FETCHING', 'READY', 'FAILED', 'SKIPPED')
      )
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ix_alarm_evidence_video_pending
      ON notification.alarm_evidence (video_status, created_at ASC)
      WHERE video_status = 'PENDING'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ix_alarm_evidence_video_command
      ON notification.alarm_evidence (video_command_id)
      WHERE video_command_id IS NOT NULL
  `);
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS notification.ix_alarm_evidence_video_pending`);
  await knex.raw(`DROP INDEX IF EXISTS notification.ix_alarm_evidence_video_command`);
  await knex.raw(`
    ALTER TABLE notification.alarm_evidence
      DROP CONSTRAINT IF EXISTS alarm_evidence_video_status_check
  `);
  const has = await knex.schema.withSchema('notification').hasTable('alarm_evidence');
  if (!has) return;
  const hasVideoStatus = await knex.schema
    .withSchema('notification')
    .hasColumn('alarm_evidence', 'video_status');
  if (hasVideoStatus) {
    await knex.schema.withSchema('notification').alterTable('alarm_evidence', (t) => {
      t.dropColumn('video_status');
      t.dropColumn('video_channel');
      t.dropColumn('video_command_id');
    });
  }
}

/**
 * Where an alarm evidence photo came from.
 *
 * DEVICE — the unit's own event snapshot (FTP upload or D00).
 * CLIP   — a frame of the alarm's AB4 playback, stored when the unit sent no
 *          snapshot. A DEVICE photo that arrives later still replaces it.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  const has = await knex.schema.withSchema('notification').hasTable('alarm_evidence');
  if (!has) return;

  const hasSource = await knex.schema
    .withSchema('notification')
    .hasColumn('alarm_evidence', 'photo_source');
  if (!hasSource) {
    await knex.schema.withSchema('notification').alterTable('alarm_evidence', (t) => {
      t.text('photo_source').nullable();
    });
  }
  await knex.raw(`
    UPDATE notification.alarm_evidence
       SET photo_source = 'DEVICE'
     WHERE status = 'PHOTO_READY' AND photo_source IS NULL
  `);
  await knex.raw(`
    ALTER TABLE notification.alarm_evidence
      DROP CONSTRAINT IF EXISTS alarm_evidence_photo_source_check
  `);
  await knex.raw(`
    ALTER TABLE notification.alarm_evidence
      ADD CONSTRAINT alarm_evidence_photo_source_check
      CHECK (photo_source IS NULL OR photo_source IN ('DEVICE', 'CLIP'))
  `);
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(`
    ALTER TABLE notification.alarm_evidence
      DROP CONSTRAINT IF EXISTS alarm_evidence_photo_source_check
  `);
  const has = await knex.schema.withSchema('notification').hasTable('alarm_evidence');
  if (!has) return;
  const hasSource = await knex.schema
    .withSchema('notification')
    .hasColumn('alarm_evidence', 'photo_source');
  if (hasSource) {
    await knex.schema.withSchema('notification').alterTable('alarm_evidence', (t) => {
      t.dropColumn('photo_source');
    });
  }
}

/**
 * Email delivery for scheduled reports.
 *
 * - report_schedules.recipients: addresses that receive the CSV after each run.
 * - report_jobs.email_status / email_error / emailed_at: per-job delivery outcome
 *   (SENT | FAILED | SKIPPED). Email failure never fails the job — the CSV
 *   artifact stays downloadable.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    "ALTER TABLE reporting.report_schedules ADD COLUMN IF NOT EXISTS recipients text[] NOT NULL DEFAULT '{}'",
  );
  await knex.raw('ALTER TABLE reporting.report_jobs ADD COLUMN IF NOT EXISTS email_status text');
  await knex.raw('ALTER TABLE reporting.report_jobs ADD COLUMN IF NOT EXISTS email_error text');
  await knex.raw(
    'ALTER TABLE reporting.report_jobs ADD COLUMN IF NOT EXISTS emailed_at timestamptz',
  );
  await knex.raw(
    'ALTER TABLE reporting.report_jobs DROP CONSTRAINT IF EXISTS report_jobs_email_status_check',
  );
  await knex.raw(
    "ALTER TABLE reporting.report_jobs ADD CONSTRAINT report_jobs_email_status_check CHECK (email_status IS NULL OR email_status IN ('SENT','FAILED','SKIPPED'))",
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(
    'ALTER TABLE reporting.report_jobs DROP CONSTRAINT IF EXISTS report_jobs_email_status_check',
  );
  await knex.raw('ALTER TABLE reporting.report_jobs DROP COLUMN IF EXISTS emailed_at');
  await knex.raw('ALTER TABLE reporting.report_jobs DROP COLUMN IF EXISTS email_error');
  await knex.raw('ALTER TABLE reporting.report_jobs DROP COLUMN IF EXISTS email_status');
  await knex.raw('ALTER TABLE reporting.report_schedules DROP COLUMN IF EXISTS recipients');
}

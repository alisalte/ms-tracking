/**
 * Driver / shift (haul-shifts) reports can be scheduled and emailed as Excel.
 *
 * - report_type CHECK widened to allow 'haul-shifts' (route_id required, like 'haul-cycles').
 * - report_schedules.route_ids: every route a 'haul-shifts' schedule reads as one work day
 *   (a day-shift and a night-shift route, for example); route_id keeps the first.
 * - report_jobs.artifact_bytes: binary artifact (.xlsx) for reports that are not CSV.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    'ALTER TABLE reporting.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_report_type_check',
  );
  await knex.raw(
    "ALTER TABLE reporting.report_schedules ADD CONSTRAINT report_schedules_report_type_check CHECK (report_type IN ('trips','vehicle-utilization','alarms','haul-cycles','haul-shifts'))",
  );
  await knex.raw('ALTER TABLE reporting.report_jobs ADD COLUMN IF NOT EXISTS artifact_bytes bytea');
  await knex.raw(
    'ALTER TABLE reporting.report_schedules ADD COLUMN IF NOT EXISTS route_ids uuid[]',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw('ALTER TABLE reporting.report_schedules DROP COLUMN IF EXISTS route_ids');
  await knex.raw('ALTER TABLE reporting.report_jobs DROP COLUMN IF EXISTS artifact_bytes');
  await knex.raw("DELETE FROM reporting.report_schedules WHERE report_type = 'haul-shifts'");
  await knex.raw(
    'ALTER TABLE reporting.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_report_type_check',
  );
  await knex.raw(
    "ALTER TABLE reporting.report_schedules ADD CONSTRAINT report_schedules_report_type_check CHECK (report_type IN ('trips','vehicle-utilization','alarms','haul-cycles'))",
  );
}

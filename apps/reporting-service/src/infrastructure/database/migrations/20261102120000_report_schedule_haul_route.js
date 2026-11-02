/**
 * Haul-cycle (service) reports can be scheduled and emailed.
 *
 * - report_schedules.route_id: the haul route a 'haul-cycles' schedule reports on
 *   (required for that type, NULL otherwise). No FK — the route lives in the fleet schema.
 * - report_type CHECK widened to allow 'haul-cycles'.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE reporting.report_schedules ADD COLUMN IF NOT EXISTS route_id uuid');
  await knex.raw(
    'ALTER TABLE reporting.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_report_type_check',
  );
  await knex.raw(
    "ALTER TABLE reporting.report_schedules ADD CONSTRAINT report_schedules_report_type_check CHECK (report_type IN ('trips','vehicle-utilization','alarms','haul-cycles'))",
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw("DELETE FROM reporting.report_schedules WHERE report_type = 'haul-cycles'");
  await knex.raw(
    'ALTER TABLE reporting.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_report_type_check',
  );
  await knex.raw(
    "ALTER TABLE reporting.report_schedules ADD CONSTRAINT report_schedules_report_type_check CHECK (report_type IN ('trips','vehicle-utilization','alarms'))",
  );
  await knex.raw('ALTER TABLE reporting.report_schedules DROP COLUMN IF EXISTS route_id');
}

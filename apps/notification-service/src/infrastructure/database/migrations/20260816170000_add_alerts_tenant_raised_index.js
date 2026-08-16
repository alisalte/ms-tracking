/**
 * Sprint J — time-leading index for the reporting service's alarm aggregates.
 *
 * notification.alerts indexes lead with (tenant_id, status/severity/vehicle,
 * raised_at); the reporting layer aggregates by tenant + time ONLY (all
 * statuses/severities at once). Additive, forward-only.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ix_alerts_tenant_raised ON notification.alerts (tenant_id, raised_at DESC)',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS notification.ix_alerts_tenant_raised');
}

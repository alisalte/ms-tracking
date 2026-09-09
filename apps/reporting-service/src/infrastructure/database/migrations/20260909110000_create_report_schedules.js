/**
 * Report schedules + jobs (Phase 1 / F-05).
 * Owns the `reporting` schema — analytical write side for schedule metadata only.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS reporting');

  const hasSchedules = await knex.schema.withSchema('reporting').hasTable('report_schedules');
  if (!hasSchedules) {
    await knex.schema.withSchema('reporting').createTable('report_schedules', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.text('name').notNullable();
      t.text('report_type').notNullable().checkIn(['trips', 'vehicle-utilization', 'alarms']);
      t.text('cadence').notNullable().checkIn(['daily', 'weekly']);
      t.text('preset').notNullable().defaultTo('7d');
      t.boolean('enabled').notNullable().defaultTo(true);
      t.timestamp('next_run_at', { useTz: true }).notNullable();
      t.timestamp('last_run_at', { useTz: true }).nullable();
      t.uuid('created_by').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(
      'CREATE INDEX ix_report_schedules_due ON reporting.report_schedules (enabled, next_run_at) WHERE enabled = true',
    );
    await knex.raw(
      'CREATE INDEX ix_report_schedules_tenant ON reporting.report_schedules (tenant_id, created_at DESC)',
    );
  }

  const hasJobs = await knex.schema.withSchema('reporting').hasTable('report_jobs');
  if (!hasJobs) {
    await knex.schema.withSchema('reporting').createTable('report_jobs', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('schedule_id').nullable();
      t.text('report_type').notNullable();
      t.text('status').notNullable().checkIn(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']);
      t.text('filename').nullable();
      t.text('artifact_csv').nullable();
      t.integer('row_count').nullable();
      t.text('error').nullable();
      t.timestamp('started_at', { useTz: true }).nullable();
      t.timestamp('finished_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(
      'CREATE INDEX ix_report_jobs_tenant ON reporting.report_jobs (tenant_id, created_at DESC)',
    );
    await knex.raw(
      'CREATE INDEX ix_report_jobs_schedule ON reporting.report_jobs (schedule_id, created_at DESC)',
    );
  }

  for (const table of ['report_schedules', 'report_jobs']) {
    await knex.raw(`ALTER TABLE reporting."${table}" ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`ALTER TABLE reporting."${table}" FORCE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON reporting."${table}"`);
    await knex.raw(`
      CREATE POLICY "${table}_tenant_isolation" ON reporting."${table}"
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

  await knex.raw('GRANT USAGE ON SCHEMA reporting TO fleetvision_app, fleetvision_platform');
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA reporting TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  for (const table of ['report_jobs', 'report_schedules']) {
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON reporting."${table}"`);
    await knex.schema.withSchema('reporting').dropTableIfExists(table);
  }
}

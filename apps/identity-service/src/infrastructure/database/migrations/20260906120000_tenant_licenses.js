/**
 * Tenant license + usage (SaaS-Ops). One license row and one usage row per
 * tenant. Live vehicle/device/driver/user counts are queried at read time;
 * storage and monthly download bytes are stored here until media metering lands.
 *
 * RLS matches iam.tenants: platform GUC or own tenant_id.
 *
 * @param {import('knex').Knex} knex
 */

const PLATFORM_PREDICATE = "current_setting('app.is_platform', true) = 'true'";
const TENANT_PREDICATE =
  "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";
const PREDICATE = `(${PLATFORM_PREDICATE}) OR (${TENANT_PREDICATE})`;

const GiB = 1024 * 1024 * 1024;

export async function up(knex) {
  await knex.schema.withSchema('iam').createTable('tenant_licenses', (t) => {
    t.uuid('tenant_id').primary().references('id').inTable('iam.tenants').onDelete('CASCADE');
    t.text('license_key').notNullable();
    t.text('plan_code')
      .notNullable()
      .checkIn(['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE', 'CUSTOM']);
    t.timestamp('starts_at', { useTz: true }).notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.integer('grace_days').notNullable().defaultTo(7);
    t.integer('max_users').notNullable();
    t.integer('max_vehicles').notNullable();
    t.integer('max_devices').notNullable();
    t.integer('max_drivers').notNullable();
    t.bigInteger('max_storage_bytes').notNullable();
    t.bigInteger('max_download_bytes_month').notNullable();
    t.integer('max_concurrent_sessions').notNullable();
    t.integer('session_idle_minutes').notNullable();
    t.integer('session_absolute_hours').notNullable();
    t.integer('login_hours_start').nullable();
    t.integer('login_hours_end').nullable();
    t.text('timezone').notNullable().defaultTo('Asia/Tehran');
    t.text('notes').nullable();
    t.jsonb('features').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['license_key'], { indexName: 'iam_tenant_licenses_key_unique' });
    t.index(['expires_at'], 'iam_tenant_licenses_expires_idx');
  });

  await knex.schema.withSchema('iam').createTable('tenant_usage', (t) => {
    t.uuid('tenant_id').primary().references('id').inTable('iam.tenants').onDelete('CASCADE');
    t.bigInteger('storage_bytes').notNullable().defaultTo(0);
    t.bigInteger('download_bytes_month').notNullable().defaultTo(0);
    t.timestamp('download_period_start', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw('ALTER TABLE iam.tenant_licenses ENABLE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS tenant_licenses_isolation ON iam.tenant_licenses');
  await knex.raw(
    `CREATE POLICY tenant_licenses_isolation ON iam.tenant_licenses USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
  );

  await knex.raw('ALTER TABLE iam.tenant_usage ENABLE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS tenant_usage_isolation ON iam.tenant_usage');
  await knex.raw(
    `CREATE POLICY tenant_usage_isolation ON iam.tenant_usage USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
  );

  await knex.raw('GRANT SELECT ON iam.tenant_licenses TO fleetvision_app, fleetvision_platform');
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE ON iam.tenant_usage TO fleetvision_app, fleetvision_platform',
  );

  const tenants = await knex('iam.tenants').select('id', 'tier', 'created_at');
  for (const t of tenants) {
    const plan = t.tier === 'ENTERPRISE' || t.tier === 'PROFESSIONAL' ? t.tier : 'STANDARD';
    const defaults = defaultsFor(plan);
    const key = `FV-${planPrefix(plan)}-${new Date(t.created_at).getUTCFullYear()}-${String(t.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const starts = t.created_at;
    const expires = new Date(new Date(t.created_at).getTime() + 365 * 24 * 60 * 60 * 1000);
    await knex('iam.tenant_licenses')
      .insert({
        tenant_id: t.id,
        license_key: key,
        plan_code: plan,
        starts_at: starts,
        expires_at: expires,
        grace_days: 7,
        ...defaults,
        timezone: 'Asia/Tehran',
        features: JSON.stringify({}),
      })
      .onConflict('tenant_id')
      .ignore();
    await knex('iam.tenant_usage')
      .insert({ tenant_id: t.id, storage_bytes: 0, download_bytes_month: 0 })
      .onConflict('tenant_id')
      .ignore();
  }
}

export async function down(knex) {
  await knex.raw('DROP POLICY IF EXISTS tenant_usage_isolation ON iam.tenant_usage');
  await knex.raw('DROP POLICY IF EXISTS tenant_licenses_isolation ON iam.tenant_licenses');
  await knex.schema.withSchema('iam').dropTableIfExists('tenant_usage');
  await knex.schema.withSchema('iam').dropTableIfExists('tenant_licenses');
}

function planPrefix(plan) {
  if (plan === 'ENTERPRISE') return 'ENT';
  if (plan === 'PROFESSIONAL') return 'PRO';
  return 'STD';
}

function defaultsFor(plan) {
  if (plan === 'ENTERPRISE') {
    return {
      max_users: 200,
      max_vehicles: 2000,
      max_devices: 2000,
      max_drivers: 500,
      max_storage_bytes: 200 * GiB,
      max_download_bytes_month: 1024 * GiB,
      max_concurrent_sessions: 100,
      session_idle_minutes: 60,
      session_absolute_hours: 24,
    };
  }
  if (plan === 'PROFESSIONAL') {
    return {
      max_users: 50,
      max_vehicles: 500,
      max_devices: 500,
      max_drivers: 150,
      max_storage_bytes: 50 * GiB,
      max_download_bytes_month: 200 * GiB,
      max_concurrent_sessions: 20,
      session_idle_minutes: 45,
      session_absolute_hours: 16,
    };
  }
  return {
    max_users: 10,
    max_vehicles: 100,
    max_devices: 100,
    max_drivers: 25,
    max_storage_bytes: 10 * GiB,
    max_download_bytes_month: 50 * GiB,
    max_concurrent_sessions: 5,
    session_idle_minutes: 30,
    session_absolute_hours: 12,
  };
}

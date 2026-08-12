/**
 * Sprint 1 (Security & Multi-Tenant Hardening) — replace the permissive MVP RLS
 * policies (`USING (true) WITH CHECK (true)`) with real tenant-aware policies,
 * introduce a dedicated non-superuser application role so RLS is actually
 * enforced (PostgreSQL bypasses RLS for superusers and table owners), and add
 * FORCE ROW LEVEL SECURITY as defense-in-depth.
 *
 * WHY A ROLE CHANGE IS MANDATORY
 *   The bootstrap `fleetvision` user is SUPERUSER and owns every table, so RLS
 *   never applied to it — the permissive policies were a no-op even after being
 *   "enabled". From this migration on:
 *     - ordinary requests connect as `fleetvision_app` (NOBYPASSRLS, not owner)
 *       and are subject to tenant-aware RLS;
 *     - platform operations (tenant provisioning, cross-tenant audit reads) run
 *       against a `fleetvision_platform` client (BYPASSRLS) or set
 *       `app.is_platform = 'true'` for the tables whose policy branches on it.
 *
 * The tenant id is read from the per-transaction session variable
 * `app.current_tenant_id` (set by `withTenantContext` after a strict UUID
 * assertion). `current_setting(..., true)` returns NULL when unset, so a missing
 * context fails CLOSED (no rows visible) rather than erroring — the safe default.
 *
 * Role passwords are read from env (`FLEETVISION_APP_ROLE_PASSWORD`,
 * `FLEETVISION_PLATFORM_ROLE_PASSWORD`) with dev defaults. Production MUST
 * override both via the secret store (Vault Transit lands in a later sprint).
 *
 * @param {import("knex").Knex} knex
 */
const APP_ROLE = 'fleetvision_app';
const PLATFORM_ROLE = 'fleetvision_platform';

function appRolePassword() {
  return process.env.FLEETVISION_APP_ROLE_PASSWORD ?? 'fleetvision_app_dev';
}

function platformRolePassword() {
  return process.env.FLEETVISION_PLATFORM_ROLE_PASSWORD ?? 'fleetvision_platform_dev';
}

// Tenant-scoped tables in the iam schema (every row carries tenant_id).
const IAM_TENANT_TABLES = [
  'users',
  'password_history',
  'roles',
  'role_permissions',
  'user_roles',
  'organizations',
  'api_keys',
  'refresh_token_families',
  'refresh_tokens',
  'auth_sessions',
];

// Tracking/dispatch tables that also carry tenant_id and must be isolated.
const OTHER_TENANT_TABLES = [
  { schema: 'audit', table: 'audit_entries' },
  { schema: 'public', table: 'event_outbox' },
];

export async function up(knex) {
  // --- 1. Create the application roles (idempotent) -------------------------
  // DO blocks let us CREATE ROLE with exception swallowing; ALTER ROLE sets the
  // password on subsequent runs so rotation via env is honored.
  await knex.raw(
    `DO $$ BEGIN
       CREATE ROLE ${APP_ROLE} WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
     EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  );
  await knex.raw(
    `DO $$ BEGIN
       CREATE ROLE ${PLATFORM_ROLE} WITH LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
     EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  );
  // Set/rotate passwords from env (escaped of single quotes).
  const appPw = appRolePassword().replaceAll("'", "''");
  const platPw = platformRolePassword().replaceAll("'", "''");
  await knex.raw(`ALTER ROLE ${APP_ROLE} WITH PASSWORD '${appPw}'`);
  await knex.raw(`ALTER ROLE ${PLATFORM_ROLE} WITH PASSWORD '${platPw}'`);

  // --- 2. Grants -------------------------------------------------------------
  // Both roles get schema USAGE + table CRUD + sequences on the schemas that
  // exist today. Using GRANT ... ON ALL TABLES IN SCHEMA covers current tables;
  // future tables must be granted explicitly (the default-privileges grant below
  // covers objects created by the bootstrap owner going forward).
  const schemas = ['iam', 'audit', 'tracking', 'geo', 'media', 'telemetry', 'public'];
  for (const schema of schemas) {
    // Grant USAGE on schema (idempotent enough; ignore if schema doesn't exist).
    await knex.raw(
      `DO $$ BEGIN GRANT USAGE ON SCHEMA "${schema}" TO ${APP_ROLE}, ${PLATFORM_ROLE};
       EXCEPTION WHEN invalid_schema_name THEN NULL; END $$;`,
    );
    await knex.raw(
      `DO $$ BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${APP_ROLE}, ${PLATFORM_ROLE};
       EXCEPTION WHEN invalid_schema_name THEN NULL; END $$;`,
    );
    await knex.raw(
      `DO $$ BEGIN GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO ${APP_ROLE}, ${PLATFORM_ROLE};
       EXCEPTION WHEN invalid_schema_name THEN NULL; END $$;`,
    );
  }
  // Default privileges for tables the bootstrap owner creates later.
  await knex.raw(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA iam GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}, ${PLATFORM_ROLE}`,
  );

  // --- 3. FORCE ROW LEVEL SECURITY + tenant-aware policies -------------------
  // FORCE applies RLS even to the table owner (belt-and-braces; the app role
  // isn't the owner anyway). The platform role has BYPASSRLS so it is unaffected.
  for (const table of IAM_TENANT_TABLES) {
    await hardenTenantTable(knex, 'iam', table);
  }
  for (const { schema, table } of OTHER_TENANT_TABLES) {
    await hardenTenantTable(knex, schema, table);
  }

  // --- 4. iam.tenants — cross-tenant readable by platform, self-readable ----
  // tenants has a self-referential tenant_id; a tenant can read its own row, and
  // the platform (app.is_platform = 'true' OR BYPASSRLS role) can read all.
  await knex.raw('ALTER TABLE iam.tenants ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE iam.tenants FORCE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS tenants_isolation ON iam.tenants');
  await knex.raw(`
    CREATE POLICY tenants_isolation ON iam.tenants
      USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
      )
      WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
      )
  `);

  // --- 5. Grant on the iam.tenants sequence (if any) + ensure sequences ----
  // (No explicit sequence on tenants; gen_random_uuid() is used. No-op safe.)
}

/**
 * Enable + FORCE RLS on a tenant table and install a tenant-aware policy that
 * admits a row iff its tenant_id equals the session's current tenant (or the
 * platform flag is set). Drops the prior permissive policy first.
 */
async function hardenTenantTable(knex, schema, table) {
  const qualified = `"${schema}"."${table}"`;
  const policyName = `${table}_tenant_isolation`;
  await knex.raw(`ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS "${policyName}" ON ${qualified}`);
  await knex.raw(`
    CREATE POLICY "${policyName}" ON ${qualified}
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

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  // Restore the permissive MVP policies so a rollback leaves the DB operable.
  const allTables = [
    ...IAM_TENANT_TABLES.map((t) => ({ schema: 'iam', table: t })),
    ...OTHER_TENANT_TABLES,
  ];
  for (const { schema, table } of allTables) {
    const qualified = `"${schema}"."${table}"`;
    const policyName = `${table}_tenant_isolation`;
    await knex.raw(`ALTER TABLE ${qualified} NO FORCE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS "${policyName}" ON ${qualified}`);
    await knex.raw(`CREATE POLICY "${policyName}" ON ${qualified} USING (true) WITH CHECK (true)`);
  }
  // iam.tenants
  await knex.raw('ALTER TABLE iam.tenants NO FORCE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS tenants_isolation ON iam.tenants');
  await knex.raw('CREATE POLICY tenants_isolation ON iam.tenants USING (true) WITH CHECK (true)');
  // Revoke default privileges; leave the roles in place (operator can drop them).
}

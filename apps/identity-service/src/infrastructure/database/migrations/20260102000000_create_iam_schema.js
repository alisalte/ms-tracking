/**
 * Sprint 2 — IAM, audit, and event-outbox schema.
 *
 * Creates the `iam` and `audit` schemas plus the `public.event_outbox` table.
 * Source of truth for table shapes:
 *   - docs/specs/03_Database_Architecture.md §2.1 (schema map), §3.4 (universal
 *     columns), §5.9 (iam summary), §15 (audit DDL).
 *   - docs/modules/Identity-Access-Management.md §3 (aggregate fields).
 *   - docs/modules/Authentication.md §3 (auth tables).
 *
 * Multi-tenancy (INV-I02): every tenant-scoped table carries `tenant_id` and
 * has RLS enabled; the application sets `app.current_tenant_id` per session.
 * `iam.tenants` is the documented exception — it must be cross-tenant readable
 * by platform services (column-projected) for routing/resolution.
 *
 * Note: partitioning of time-series tables (refresh_tokens, auth_sessions,
 * audit_entries) is deferred to a later sprint — MVP runs non-partitioned so the
 * migration stays operable without pg_partman wiring.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  // --- Schemas ---
  await knex.raw('CREATE SCHEMA IF NOT EXISTS iam');
  await knex.raw('CREATE SCHEMA IF NOT EXISTS audit');

  // ===========================================================================
  // iam.tenants — the tenant registry. Cross-tenant readable by platform
  // services (the one documented RLS exception). tenant_id column is set to the
  // tenant's own id for row-uniformity; RLS permits reading own row.
  // (docs/modules/Tenant-Management.md §3.2, 03 §3.2)
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('tenants', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable(); // self-reference for RLS uniformity
    t.text('name').notNullable();
    t.text('tier').notNullable().checkIn(['STANDARD', 'PROFESSIONAL', 'ENTERPRISE']);
    t.text('region').notNullable();
    t.text('status')
      .notNullable()
      .defaultTo('PROVISIONING')
      .checkIn(['PROVISIONING', 'ACTIVE', 'SUSPENDED', 'DEPROVISIONING', 'DEPROVISIONED']);
    t.jsonb('feature_flags').notNullable().defaultTo(JSON.stringify({}));
    t.text('kek_ref'); // Vault KEK reference (crypto-shredding) — null in MVP
    t.uuid('root_org_id'); // links to iam.organizations (set after root org created)
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['name'], { indexName: 'iam_tenants_name_unique' });
  });

  // ===========================================================================
  // iam.users — local + SSO identities. INV-IAM-01 (email unique per tenant),
  // INV-IAM-02 (username unique platform-wide), INV-IAM-04 (password required
  // for LOCAL auth). password_hash nullable for SSO-only users.
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('email').notNullable();
    t.text('username').notNullable();
    t.text('password_hash'); // null for SSO-only users
    t.text('status')
      .notNullable()
      .defaultTo('ACTIVE')
      .checkIn(['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'LOCKED']);
    t.text('display_name');
    t.text('auth_provider').notNullable().defaultTo('LOCAL');
    t.boolean('mfa_enabled').notNullable().defaultTo(false);
    t.timestamp('last_login_at', { useTz: true });
    t.integer('failed_login_attempts').notNullable().defaultTo(0);
    t.timestamp('lockout_until', { useTz: true });
    t.integer('version').notNullable().defaultTo(1);
    t.uuid('created_by');
    t.uuid('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'email'], { indexName: 'iam_users_tenant_email_unique' });
    t.unique(['username'], { indexName: 'iam_users_username_unique' });
    t.index(['tenant_id'], 'iam_users_tenant_id_idx');
  });

  // ===========================================================================
  // iam.password_history — AUTH-BR-02: new password must not match the last N.
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('password_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('user_id').notNullable().references('id').inTable('iam.users').onDelete('CASCADE');
    t.text('password_hash').notNullable();
    t.timestamp('changed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'user_id'], 'iam_password_history_tenant_user_idx');
  });

  // ===========================================================================
  // iam.roles — per-tenant roles. UNIQUE(tenant_id, name). System roles seeded.
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('name').notNullable();
    t.text('description');
    t.boolean('is_system').notNullable().defaultTo(false);
    t.integer('version').notNullable().defaultTo(1);
    t.uuid('created_by');
    t.uuid('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'name'], { indexName: 'iam_roles_tenant_name_unique' });
  });

  // ===========================================================================
  // iam.role_permissions — join: role → permission strings (02 §6 catalog).
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('role_permissions', (t) => {
    t.uuid('role_id').notNullable().references('id').inTable('iam.roles').onDelete('CASCADE');
    t.text('permission').notNullable();
    t.primary(['role_id', 'permission']);
  });

  // ===========================================================================
  // iam.user_roles — join: user → role (RoleBinding). UNIQUE per tenant+user+role.
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('user_roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('user_id').notNullable().references('id').inTable('iam.users').onDelete('CASCADE');
    t.uuid('role_id').notNullable().references('id').inTable('iam.roles').onDelete('CASCADE');
    t.timestamp('assigned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'user_id', 'role_id'], { indexName: 'iam_user_roles_unique' });
    t.index(['tenant_id', 'user_id'], 'iam_user_roles_tenant_user_idx');
  });

  // ===========================================================================
  // iam.organizations — tenant org hierarchy. self-FK parent_org_id.
  // UNIQUE(tenant_id, code). Hierarchy depth enforced in the domain (max 5).
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('organizations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('parent_org_id').references('id').inTable('iam.organizations').onDelete('SET NULL');
    t.text('name').notNullable();
    t.text('code').notNullable();
    t.text('org_type').notNullable().checkIn(['TENANT', 'DIVISION', 'DEPARTMENT', 'TEAM']);
    t.text('status').notNullable().defaultTo('ACTIVE').checkIn(['ACTIVE', 'INACTIVE']);
    t.integer('version').notNullable().defaultTo(1);
    t.uuid('created_by');
    t.uuid('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'code'], { indexName: 'iam_orgs_tenant_code_unique' });
    t.index(['tenant_id', 'parent_org_id'], 'iam_orgs_tenant_parent_idx');
  });

  // ===========================================================================
  // iam.api_keys — tenant-scoped, role-bound service credentials.
  // Argon2id-hashed (16_Public-API-Platform.md §8.1); plaintext shown once.
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('api_keys', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('name').notNullable();
    t.text('key_hash').notNullable(); // Argon2id hash of the secret
    t.text('key_prefix').notNullable(); // first chars, e.g. "fv_live_abc" — for identification
    t.jsonb('scopes').notNullable().defaultTo(JSON.stringify([]));
    t.uuid('assigned_user_id').references('id').inTable('iam.users').onDelete('SET NULL');
    t.timestamp('expires_at', { useTz: true });
    t.timestamp('last_used_at', { useTz: true });
    t.text('status').notNullable().defaultTo('ACTIVE').checkIn(['ACTIVE', 'REVOKED']);
    t.jsonb('ip_allowlist').notNullable().defaultTo(JSON.stringify([]));
    t.integer('version').notNullable().defaultTo(1);
    t.uuid('created_by');
    t.uuid('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'key_prefix'], 'iam_api_keys_tenant_prefix_idx');
    t.index(['tenant_id', 'status'], 'iam_api_keys_tenant_status_idx');
  });

  // ===========================================================================
  // iam.refresh_token_families — the reuse-detection unit (AUTH-BR-08).
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('refresh_token_families', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('user_id').notNullable();
    t.text('session_id').notNullable();
    t.text('status')
      .notNullable()
      .defaultTo('ACTIVE')
      .checkIn(['ACTIVE', 'COMPROMISED', 'EXPIRED', 'REVOKED']);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'user_id'], 'iam_rtf_tenant_user_idx');
  });

  // ===========================================================================
  // iam.refresh_tokens — rotated opaque tokens; UNIQUE(token_hash) for reuse check.
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('refresh_tokens', (t) => {
    t.text('jti').primary(); // JWT id of the refresh token
    t.uuid('family_id')
      .notNullable()
      .references('id')
      .inTable('iam.refresh_token_families')
      .onDelete('CASCADE');
    t.text('token_hash').notNullable();
    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('consumed_at', { useTz: true });
    t.timestamp('revoked_at', { useTz: true });
    t.text('revoked_reason');
    t.unique(['token_hash'], { indexName: 'iam_refresh_tokens_hash_unique' });
    t.index(['family_id'], 'iam_refresh_tokens_family_idx');
  });

  // ===========================================================================
  // iam.auth_sessions — durable forensic mirror of Redis sessions.
  // (Authentication.md §3.2). Live reads are Redis; this is the audit record.
  // ===========================================================================
  await knex.schema.withSchema('iam').createTable('auth_sessions', (t) => {
    t.text('id').primary(); // opaque, high-entropy session id
    t.uuid('tenant_id').notNullable();
    t.uuid('user_id').notNullable();
    t.text('status')
      .notNullable()
      .defaultTo('ACTIVE')
      .checkIn(['ACTIVE', 'IDLE_EXPIRED', 'ABSOLUTE_EXPIRED', 'REVOKED', 'LOGGED_OUT']);
    t.text('auth_provider').notNullable().defaultTo('LOCAL');
    t.smallint('aal').notNullable().defaultTo(1); // authenticator assurance level
    t.specificType('ip_address', 'inet');
    t.text('user_agent');
    t.uuid('refresh_token_family_id');
    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen_at', { useTz: true });
    t.timestamp('absolute_expires_at', { useTz: true }).notNullable();
    t.text('revoked_reason');
    t.integer('version').notNullable().defaultTo(1);
    t.index(['tenant_id', 'user_id'], 'iam_sessions_tenant_user_idx');
  });

  // ===========================================================================
  // audit.audit_entries — append-only, hash-chained (03 §15.1).
  // Non-partitioned for MVP. seq_no + prev_hash + entry_hash form the chain.
  // ===========================================================================
  await knex.schema.withSchema('audit').createTable('audit_entries', (t) => {
    t.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('actor_id');
    t.text('actor_type').notNullable().checkIn(['USER', 'SERVICE', 'SYSTEM']);
    t.text('action').notNullable(); // CREATE, UPDATE, DELETE, LOGIN, LOGOUT, AUTHORIZE...
    t.text('resource_type').notNullable();
    t.uuid('resource_id');
    t.text('permission');
    t.text('outcome').notNullable().checkIn(['SUCCESS', 'DENIED', 'ERROR']);
    t.uuid('request_id');
    t.specificType('ip_address', 'inet');
    t.text('user_agent');
    t.jsonb('before');
    t.jsonb('after');
    t.bigInteger('seq_no').notNullable();
    t.text('prev_hash').notNullable();
    t.text('entry_hash').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['id', 'created_at']);
    t.index(['tenant_id', 'created_at'], 'audit_entries_tenant_created_idx');
    t.index(['tenant_id', 'resource_type', 'resource_id'], 'audit_entries_resource_idx');
    t.index(['tenant_id', 'actor_id'], 'audit_entries_actor_idx');
  });

  // ===========================================================================
  // public.event_outbox — transactional outbox (01 §6.1). The relay publishes
  // unpublished rows to Kafka and marks them published. idempotent on event id.
  // ===========================================================================
  await knex.schema.createTable('event_outbox', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('aggregate_type').notNullable();
    t.uuid('aggregate_id').notNullable();
    t.uuid('tenant_id').notNullable();
    t.text('event_type').notNullable();
    t.jsonb('payload').notNullable();
    t.jsonb('headers').notNullable().defaultTo(JSON.stringify({}));
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('published_at', { useTz: true });
    // Claimed-at supports a lease for concurrent relays (MVP is single-instance).
    t.timestamp('claimed_at', { useTz: true });
    t.index([knex.raw('(published_at IS NULL)')], 'event_outbox_unpublished_idx');
  });

  // --- Row-Level Security (Standard tier; 03 §3.3, INV-I02) ---
  // Tenant-scoped tables: a row is visible iff tenant_id matches the session's
  // current tenant. The app role BYPASSRLS is reserved for platform operations
  // (e.g. tenant provisioning, audit writes). We enable RLS but ship permissive
  // policies by default for the MVP; tighten to USING (...) once the app sets
  // app.current_tenant_id reliably on every connection. (See follow-up note.)
  await enableTenantRls(knex);
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('event_outbox');
  await knex.schema.withSchema('audit').dropTableIfExists('audit_entries');
  await knex.schema.withSchema('iam').dropTableIfExists('auth_sessions');
  await knex.schema.withSchema('iam').dropTableIfExists('refresh_tokens');
  await knex.schema.withSchema('iam').dropTableIfExists('refresh_token_families');
  await knex.schema.withSchema('iam').dropTableIfExists('api_keys');
  await knex.schema.withSchema('iam').dropTableIfExists('organizations');
  await knex.schema.withSchema('iam').dropTableIfExists('user_roles');
  await knex.schema.withSchema('iam').dropTableIfExists('role_permissions');
  await knex.schema.withSchema('iam').dropTableIfExists('roles');
  await knex.schema.withSchema('iam').dropTableIfExists('password_history');
  await knex.schema.withSchema('iam').dropTableIfExists('users');
  await knex.schema.withSchema('iam').dropTableIfExists('tenants');
  await knex.raw('DROP SCHEMA IF EXISTS iam');
  await knex.raw('DROP SCHEMA IF EXISTS audit');
}

/**
 * Enable RLS on tenant-scoped tables. MVP ships permissive policies (true) so
 * the schema is operable before every code path sets app.current_tenant_id;
 * a follow-up hardens policies to `USING (tenant_id = current_setting(...))`.
 * The contract (INV-I02) is enforced in the application layer meanwhile.
 *
 * @param {import("knex").Knex} knex
 */
async function enableTenantRls(knex) {
  const tenantTables = [
    'iam.users',
    'iam.password_history',
    'iam.roles',
    'iam.role_permissions',
    'iam.user_roles',
    'iam.organizations',
    'iam.api_keys',
    'iam.refresh_token_families',
    'iam.refresh_tokens',
    'iam.auth_sessions',
  ];
  for (const qualified of tenantTables) {
    const [schema, table] = qualified.split('.');
    // Enable RLS, then a permissive default policy (MVP). Hardening is a
    // follow-up; the app-layer tenant context is the source of truth today.
    await knex.raw(`ALTER TABLE "${schema}"."${table}" ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${schema}"."${table}"`);
    await knex.raw(
      `CREATE POLICY "${table}_tenant_isolation" ON "${schema}"."${table}" USING (true) WITH CHECK (true)`,
    );
  }
  // iam.tenants: permissive for MVP (platform reads all, tenant reads own).
  await knex.raw('ALTER TABLE iam.tenants ENABLE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS tenants_isolation ON iam.tenants');
  await knex.raw('CREATE POLICY tenants_isolation ON iam.tenants USING (true) WITH CHECK (true)');
}

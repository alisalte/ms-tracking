/**
 * Sprint 3 — telemetry.gateway_listeners (06 §16.3, open item G-1).
 *
 * Protocol/listener configuration lives in PostgreSQL as JSONB per ADR-022
 * (replaces the prior MongoDB design). The table is owned by the Telematics
 * context (03 §2.1). Source-of-truth DDL: docs/specs/06_Device_Gateway.md §16.3.
 *
 * This resolves open item **G-1** (06 §18.3): the table is new to the device
 * gateway spec and should be added to 03 §2.1's Telematics inventory + §5.9 in
 * the next 03 revision. Until then it lives in this per-service migration (the
 * gateway is the sole writer/reader for Sprint 3).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS telemetry');

  await knex.schema.withSchema('telemetry').createTable('gateway_listeners', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('adapter_id').notNullable(); // 'gt06', 'teltonika', 'jt808', ...
    t.boolean('enabled').notNullable().defaultTo(true);
    t.text('transport').notNullable().checkIn(['tcp', 'udp', 'both']);
    t.integer('port').notNullable();
    // idle-timeout, keepalive, codec flags, ...
    t.jsonb('options').notNullable().defaultTo(JSON.stringify({}));
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'adapter_id', 'transport'], {
      indexName: 'telemetry_listeners_tenant_adapter_transport_unique',
    });
  });

  await knex.raw(
    'CREATE INDEX ix_listeners_tenant_enabled ON telemetry.gateway_listeners (tenant_id) WHERE enabled',
  );

  // Row-Level Security (03 §3.3, INV-I02) — tenant-scoped config. MVP ships a
  // permissive policy (matching the iam tables' MVP approach) so the schema is
  // operable before every code path sets app.current_tenant_id; the contract is
  // enforced in the application layer meanwhile.
  await knex.raw('ALTER TABLE telemetry.gateway_listeners ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    'DROP POLICY IF EXISTS gateway_listeners_tenant_isolation ON telemetry.gateway_listeners',
  );
  await knex.raw(
    'CREATE POLICY gateway_listeners_tenant_isolation ON telemetry.gateway_listeners USING (true) WITH CHECK (true)',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.schema.withSchema('telemetry').dropTableIfExists('gateway_listeners');
  // NOTE: the `telemetry` schema is shared with other Telematics tables
  // (telematics_devices, etc.) owned by device-management-service; we do NOT
  // drop the schema here — only the gateway's table.
}

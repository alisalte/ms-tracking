/**
 * Device Commands — durable downstream-command records (02 §3.2 DeviceCommand;
 * 06 §11.3 SendDeviceCommand / §6.2 downstream command flow).
 *
 * fleet.device_commands stores every configuration/control command issued to a
 * device over its TCP session, its lifecycle status, and the device's response:
 *
 *   QUEUED → SENT (gateway wrote the frame) → ACKED / FAILED (device D82 reply)
 *   QUEUED/SENT → EXPIRED (TTL sweeper — no ack within the command TTL).
 *
 * Ack correlation: the Meitrack MDVR protocol carries no command id in its D82
 * reply (only the command code), so the ack consumer matches on
 * (tenant_id, device_id, command_code) against the latest SENT/QUEUED row.
 *
 * Conventions follow the Sprint-C fleet migration: uuid PK via
 * `gen_random_uuid()`, `created_at`/`updated_at` with useTz, optimistic
 * `version`, check-constrained enums, explicit named indexes. RLS enabled with
 * the same fail-closed tenant-isolation predicate as the hardened companion of
 * the Sprint-C migration (the repository-layer WHERE tenant_id = ? remains the
 * enforcing boundary today).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS fleet');

  await knex.schema.withSchema('fleet').createTable('device_commands', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('device_id').notNullable().references('id').inTable('fleet.devices').onDelete('CASCADE');
    /** Protocol command code, e.g. 'A11' (Meitrack MDVR GPRS Protocol V2.0). */
    t.text('command_code').notNullable();
    /** Catalog category, e.g. 'tracking' / 'geofence' / 'system' (UI grouping). */
    t.text('category').notNullable();
    /** Validated caller-supplied parameters (catalog-shaped), key → value. */
    t.jsonb('params');
    /** Wire payload after `<imei>,` — e.g. 'A11,10' (ASCII commands). */
    t.text('payload_text');
    /** Hex-encoded binary body (MDVR media struct commands) — alt to payload_text. */
    t.text('payload_hex');
    t.text('status')
      .notNullable()
      .defaultTo('QUEUED')
      .checkIn(['QUEUED', 'SENT', 'ACKED', 'FAILED', 'EXPIRED']);
    /** Raw device response (D82 body), e.g. 'A11,OK'. */
    t.text('response_text');
    /** Rejection reason / device error code, e.g. 'DEVICE_OFFLINE'. */
    t.text('error');
    /** Issuing user id (null when a service issued the command). */
    t.uuid('issued_by');
    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('sent_at', { useTz: true });
    t.timestamp('acked_at', { useTz: true });
    /** TTL deadline — the sweeper EXPIREs unacked commands past this. */
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(
      ['tenant_id', 'device_id', 'created_at'],
      'fleet_device_commands_tenant_device_created_idx',
    );
    t.index(['tenant_id', 'status'], 'fleet_device_commands_tenant_status_idx');
    // Ack-matching lookup: latest command per device+code.
    t.index(
      ['tenant_id', 'device_id', 'command_code', 'issued_at'],
      'fleet_device_commands_ack_match_idx',
    );
  });

  await knex.raw('ALTER TABLE fleet.device_commands ENABLE ROW LEVEL SECURITY');
  // Fail-closed tenant isolation (same predicate as the hardened Sprint-C policies).
  const predicate = "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";
  await knex.raw(
    `CREATE POLICY device_commands_tenant_isolation ON fleet.device_commands USING (${predicate}) WITH CHECK (${predicate})`,
  );
}

export async function down(knex) {
  await knex.raw('DROP POLICY IF EXISTS device_commands_tenant_isolation ON fleet.device_commands');
  await knex.schema.withSchema('fleet').dropTableIfExists('device_commands');
}

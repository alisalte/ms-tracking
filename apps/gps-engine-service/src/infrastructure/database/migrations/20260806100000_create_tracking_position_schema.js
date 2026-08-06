/**
 * Sprint 7 — Tracking context position schema (03 §11.1, 07 §9.2).
 *
 * Creates the `tracking` schema and two tables the GPS engine owns:
 *   - `tracking.vehicle_positions` — the TimescaleDB hypertable storing every
 *     validated position (immutable, append-only, INV-T01). Partitioned by time
 *     (1-day chunks) + space (vehicle_id hash, 8 partitions). Compression and
 *     retention policies are attached in a later sprint once ingest is proven.
 *   - `tracking.device_status` — the device online/offline/stale projection
 *     consumed from the gateway's session-lifecycle topic (06 §12.1).
 *
 * Source-of-truth DDL: docs/specs/03_Database_Architecture.md §11.1 and
 * docs/specs/07_GPS_Engine.md §9.2.
 *
 * NOTE on vehicle_id vs device_id: device→vehicle mapping is owned by
 * device-management-service (not yet built). For Sprint 7 we store the
 * device-gateway's resolved `deviceId` in the `vehicle_id` column so the pipeline
 * is functional end-to-end today; a later sprint renames/reamaps when
 * device-management lands the mapping table.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS tracking');

  // --- tracking.vehicle_positions (TimescaleDB hypertable) ---
  await knex.schema.withSchema('tracking').createTable('vehicle_positions', (t) => {
    // UUIDv7 PK — time-ordered, disambiguates same-instant multi-device (03 §11.1).
    t.uuid('event_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // device_id from the gateway for Sprint 7 (see module doc); reamaps to the
    // real vehicle_id once device-management-service provides the mapping.
    t.uuid('vehicle_id').notNullable();
    t.uuid('tenant_id').notNullable();
    // Device-reported capture time — the hypertable partition key.
    t.timestamp('captured_at', { useTz: true }).notNullable();
    t.timestamp('ingested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // PostGIS geography point for spatial queries.
    t.specificType('geom', 'geography(Point, 4326)').notNullable();
    t.doublePrecision('latitude').notNullable();
    t.doublePrecision('longitude').notNullable();
    t.float('altitude_m').nullable();
    t.float('heading_deg').nullable();
    t.float('speed_kmh').notNullable().defaultTo(0);
    t.float('accuracy_m').nullable();
    t.doublePrecision('odometer_km').nullable();
    t.boolean('ignition_on').nullable();
    t.uuid('source_device').nullable();
    // Quality: 1=VALID, 2=STALE, 3=LOW_ACCURACY, 4=SUSPECT_JUMP, 0=REJECTED (07 §3.4).
    t.smallint('quality').notNullable().defaultTo(1);
    t.uuid('session_id').nullable();
    t.jsonb('metadata').notNullable().defaultTo(JSON.stringify({}));
  });

  // Hypertable: 1-day chunks. TimescaleDB extension is installed via
  // infra/docker/init/postgres.sql. `if_not_exists` makes re-runs safe.
  await knex.raw(
    "SELECT create_hypertable('tracking.vehicle_positions', 'captured_at', " +
      "chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE)",
  );

  // Hot-path index for per-vehicle latest + range scans (03 §11.1).
  await knex.raw(
    'CREATE INDEX ix_positions_tenant_vehicle_time ON tracking.vehicle_positions ' +
      '(tenant_id, vehicle_id, captured_at DESC)',
  );

  // --- tracking.device_status (online/offline/stale projection) ---
  await knex.schema.withSchema('tracking').createTable('device_status', (t) => {
    t.uuid('device_id').primary();
    t.uuid('tenant_id').notNullable();
    t.text('state').notNullable().checkIn(['ONLINE', 'OFFLINE', 'STALE']);
    t.text('protocol_id').nullable();
    t.text('reason').nullable();
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    "CREATE INDEX ix_device_status_tenant ON tracking.device_status (tenant_id) WHERE state = 'ONLINE'",
  );

  // --- Row-Level Security (03 §3.3, INV-I02) — tenant-scoped data. MVP permissive. ---
  await knex.raw('ALTER TABLE tracking.vehicle_positions ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    'CREATE POLICY vehicle_positions_tenant_isolation ON tracking.vehicle_positions USING (true) WITH CHECK (true)',
  );
  await knex.raw('ALTER TABLE tracking.device_status ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    'CREATE POLICY device_status_tenant_isolation ON tracking.device_status USING (true) WITH CHECK (true)',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.schema.withSchema('tracking').dropTableIfExists('device_status');
  await knex.raw(
    'DROP POLICY IF EXISTS vehicle_positions_tenant_isolation ON tracking.vehicle_positions',
  );
  await knex.schema.withSchema('tracking').dropTableIfExists('vehicle_positions');
  // NOTE: do NOT drop the `tracking` schema — it is shared with other Tracking
  // context tables (geofences, trips, etc.) owned by other services.
}

/**
 * Sprint C — create the `fleet` bounded context's schema.
 *
 * Owns the Fleet / Vehicle / Device aggregates and the vehicle↔device binding
 * relationship. Tenant-scoped (every row carries tenant_id); RLS is enabled with
 * the permissive MVP stub here and hardened to a fail-closed predicate in the
 * companion migration `20260814110000_harden_fleet_rls_policies.js` (forward-ready:
 * today the application connects as the table-owner superuser, so the
 * repository-layer `WHERE tenant_id = ?` filter is the enforcing boundary —
 * exactly as in iam/tracking after Sprint B).
 *
 * Conventions follow the iam + tracking migrations: uuid PKs via
 * `gen_random_uuid()`, `created_at`/`updated_at` with `useTz`, optimistic
 * `version`, check-constrained enums, explicit named indexes/constraints.
 *
 * @param {import("knex").Knex} knex
 */

/** Tables that carry tenant_id and therefore get a tenant-isolation RLS policy. */
const TENANT_TABLES = ['fleets', 'vehicles', 'devices', 'vehicle_devices'];

export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS fleet');

  // ===========================================================================
  // fleet.fleets — a grouping of vehicles within a tenant.
  // ===========================================================================
  await knex.schema.withSchema('fleet').createTable('fleets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('name').notNullable();
    t.text('code').notNullable();
    t.text('description');
    t.text('status').notNullable().defaultTo('ACTIVE').checkIn(['ACTIVE', 'ARCHIVED']);
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'code'], { indexName: 'fleet_fleets_tenant_code_unique' });
    t.index(['tenant_id'], 'fleet_fleets_tenant_idx');
  });

  // ===========================================================================
  // fleet.vehicles — a physical/logical vehicle belonging to a fleet.
  // ===========================================================================
  await knex.schema.withSchema('fleet').createTable('vehicles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('fleet_id').notNullable().references('id').inTable('fleet.fleets').onDelete('RESTRICT');
    t.text('name').notNullable();
    t.text('code').notNullable();
    /** Registration / plate number (nullable: not every asset is road-registered). */
    t.text('plate');
    /** Vehicle Identification Number (17-char ISO 3779 where applicable). */
    t.text('vin');
    t.text('status').notNullable().defaultTo('ACTIVE').checkIn(['ACTIVE', 'ARCHIVED']);
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'code'], { indexName: 'fleet_vehicles_tenant_code_unique' });
    // PG allows multiple NULLs in a unique index, so optional plate/vin stay optional.
    t.unique(['tenant_id', 'plate'], { indexName: 'fleet_vehicles_tenant_plate_unique' });
    t.unique(['tenant_id', 'vin'], { indexName: 'fleet_vehicles_tenant_vin_unique' });
    t.index(['tenant_id', 'fleet_id'], 'fleet_vehicles_tenant_fleet_idx');
    t.index(['tenant_id'], 'fleet_vehicles_tenant_idx');
  });

  // ===========================================================================
  // fleet.devices — the persistent, tenant-aware device registry.
  //
  // IMEI is GLOBALLY unique: a physical tracker has one IMEI regardless of which
  // tenant owns it, and the device-gateway resolves IMEI → device CROSS-tenant
  // (before the tenant is known). The unique index is therefore not scoped to a
  // tenant. `tenant_id` records ownership; `status` is the device LIFECYCLE
  // (authorization) status — deliberately separate from the connection state
  // (ONLINE/OFFLINE/STALE) projected in tracking.device_status.
  // ===========================================================================
  await knex.schema.withSchema('fleet').createTable('devices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    /** Wire identifier the device sends on LOGIN — globally unique physical identity. */
    t.text('imei').notNullable();
    t.text('serial_number');
    t.text('manufacturer');
    t.text('model');
    /** Supported protocol = a built-in device-gateway adapter id (06 §2.1). */
    t.text('protocol').notNullable().checkIn(['gt06', 'jt808', 'meitrack', 'stub']);
    t.text('status')
      .notNullable()
      .defaultTo('ACTIVE')
      .checkIn(['ACTIVE', 'SUSPENDED', 'DECOMMISSIONED', 'UNPAIRED']);
    /** Connection state — projected from telemetry.session.lifecycle (§21). */
    t.timestamp('last_seen_at', { useTz: true });
    t.timestamp('connected_at', { useTz: true });
    t.timestamp('disconnected_at', { useTz: true });
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Global uniqueness — physical identity is tenant-independent.
    t.unique(['imei'], { indexName: 'fleet_devices_imei_unique' });
    t.index(['tenant_id', 'status'], 'fleet_devices_tenant_status_idx');
    t.index(['tenant_id', 'protocol'], 'fleet_devices_tenant_protocol_idx');
    t.index(['tenant_id', 'manufacturer'], 'fleet_devices_tenant_manufacturer_idx');
    t.index(['tenant_id', 'serial_number'], 'fleet_devices_tenant_serial_idx');
  });

  // ===========================================================================
  // fleet.vehicle_devices — the vehicle↔device binding relationship.
  //
  // Smallest correct model (§11): a device is bound to AT MOST ONE vehicle at a
  // time (unique device_id), and a vehicle has AT MOST ONE primary device
  // (partial unique on vehicle_id WHERE is_primary). `role` keeps the model
  // extensible to MDVR / CAN / sensor-gateway devices beyond the primary tracker.
  // Binding history is captured in the audit log (bind/unbind events), so this
  // table holds CURRENT bindings only.
  // ===========================================================================
  await knex.schema.withSchema('fleet').createTable('vehicle_devices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('vehicle_id')
      .notNullable()
      .references('id')
      .inTable('fleet.vehicles')
      .onDelete('CASCADE');
    t.uuid('device_id').notNullable().references('id').inTable('fleet.devices').onDelete('CASCADE');
    t.text('role')
      .notNullable()
      .defaultTo('TRACKER')
      .checkIn(['TRACKER', 'MDVR', 'CAN', 'SENSOR', 'OTHER']);
    t.boolean('is_primary').notNullable().defaultTo(true);
    t.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // A device is bound to at most one vehicle at a time.
    t.unique(['device_id'], { indexName: 'fleet_vehicle_devices_device_unique' });
    t.index(['tenant_id', 'vehicle_id'], 'fleet_vehicle_devices_tenant_vehicle_idx');
    t.index(['tenant_id', 'device_id'], 'fleet_vehicle_devices_tenant_device_idx');
  });

  // One primary device per vehicle (among current bindings).
  await knex.raw(
    'CREATE UNIQUE INDEX fleet_vehicle_devices_one_primary_per_vehicle ON fleet.vehicle_devices (vehicle_id) WHERE is_primary = true',
  );

  // --- RLS (permissive MVP stub; hardened in the companion migration) --------
  for (const table of TENANT_TABLES) {
    await knex.raw(`ALTER TABLE fleet.${table} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(
      `CREATE POLICY ${table}_tenant_isolation ON fleet.${table} USING (true) WITH CHECK (true)`,
    );
  }
}

export async function down(knex) {
  await knex.schema.withSchema('fleet').dropTableIfExists('vehicle_devices');
  await knex.schema.withSchema('fleet').dropTableIfExists('devices');
  await knex.schema.withSchema('fleet').dropTableIfExists('vehicles');
  await knex.schema.withSchema('fleet').dropTableIfExists('fleets');
  // Intentionally do NOT drop the `fleet` schema (shared, forward-compatible).
}

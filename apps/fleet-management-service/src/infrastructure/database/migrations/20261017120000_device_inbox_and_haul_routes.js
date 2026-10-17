/**
 * Unassigned device inbox + mine haul routes.
 *
 * An IMEI that connects before an operator claims it is stored here and is
 * not inserted into any customer tenant. Haul routes name an origin geofence,
 * a destination geofence, a shift, and the trucks/shovels assigned to them.
 *
 * @param {import('knex').Knex} knex
 */
const PREDICATE = "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";

export async function up(knex) {
  await knex.schema.withSchema('fleet').createTable('device_inbox', (t) => {
    t.text('imei').primary();
    t.text('protocol').notNullable();
    t.text('manufacturer');
    t.text('model');
    t.integer('seen_count').notNullable().defaultTo(1);
    t.timestamp('first_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('claimed_tenant_id');
    t.uuid('claimed_device_id');
    t.timestamp('claimed_at', { useTz: true });
  });
  await knex.raw('ALTER TABLE fleet.device_inbox ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    'CREATE POLICY device_inbox_platform ON fleet.device_inbox USING (true) WITH CHECK (true)',
  );

  await knex.schema.withSchema('fleet').createTable('haul_routes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('name').notNullable();
    t.uuid('origin_geofence_id').notNullable();
    t.uuid('destination_geofence_id').notNullable();
    t.integer('shift_start_hour').notNullable().defaultTo(6);
    t.integer('shift_duration_hours').notNullable().defaultTo(12);
    t.text('status').notNullable().defaultTo('ACTIVE').checkIn(['ACTIVE', 'ARCHIVED']);
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'status'], 'fleet_haul_routes_tenant_status_idx');
  });

  await knex.schema.withSchema('fleet').createTable('haul_members', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('route_id')
      .notNullable()
      .references('id')
      .inTable('fleet.haul_routes')
      .onDelete('CASCADE');
    t.uuid('device_id').notNullable().references('id').inTable('fleet.devices').onDelete('CASCADE');
    t.text('role').notNullable().checkIn(['TRUCK', 'SHOVEL']);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['route_id', 'device_id'], { indexName: 'fleet_haul_members_route_device_unique' });
    t.index(['tenant_id', 'route_id'], 'fleet_haul_members_tenant_route_idx');
  });

  for (const table of ['haul_routes', 'haul_members']) {
    await knex.raw(`ALTER TABLE fleet.${table} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(
      `CREATE POLICY ${table}_tenant_isolation ON fleet.${table} USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
    );
  }

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON fleet.device_inbox, fleet.haul_routes, fleet.haul_members TO fleetvision_app, fleetvision_platform',
  );
}

export async function down(knex) {
  await knex.schema.withSchema('fleet').dropTableIfExists('haul_members');
  await knex.schema.withSchema('fleet').dropTableIfExists('haul_routes');
  await knex.schema.withSchema('fleet').dropTableIfExists('device_inbox');
}

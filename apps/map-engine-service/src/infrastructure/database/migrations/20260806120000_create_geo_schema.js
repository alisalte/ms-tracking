/**
 * Sprint 9 — Map Engine geo schema (08 §5.1, §17.2; MapEngine.md §5.1).
 *
 * Creates the `geo` schema (owned by map-engine-service) with the POI, address,
 * and speed-limit tables, plus the `tracking.geofences` table (shared Tracking
 * context — geometry store owned by the Map Engine, evaluated by the GPS Engine).
 *
 * All spatial tables use PostGIS `geography` types with GiST indexes for O(log N)
 * spatial queries (point-in-polygon, nearest-K, bounding-box).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  // --- geo schema (Map Engine canonical geometry store) ---
  await knex.raw('CREATE SCHEMA IF NOT EXISTS geo');

  // geo.pois — Points of Interest (MapEngine.md §5.1, 08 §8.1)
  await knex.schema.withSchema('geo').createTable('pois', (t) => {
    t.uuid('poi_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // NULL tenant_id = platform POI; otherwise tenant-scoped.
    t.uuid('tenant_id').nullable();
    t.text('name').notNullable();
    t.text('category').notNullable(); // DEPOT, CUSTOMER, FUEL, YARD, CHARGER, ...
    t.specificType('geom', 'geography(Point, 4326)').notNullable();
    t.float('radius_m').defaultTo(50); // matching radius for ResolvePOI
    t.uuid('geofence_id').nullable(); // optional linked geofence
    t.jsonb('metadata').notNullable().defaultTo(JSON.stringify({}));
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX ix_pois_geom ON geo.pois USING GIST (geom)');
  await knex.raw('CREATE INDEX ix_pois_tenant ON geo.pois (tenant_id)');

  // geo.addresses — geocoded address cache (MapEngine.md §5.1)
  await knex.schema.withSchema('geo').createTable('addresses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').nullable();
    t.text('formatted_address').notNullable();
    t.specificType('geom', 'geography(Point, 4326)').notNullable();
    t.jsonb('components').notNullable().defaultTo(JSON.stringify({}));
    t.text('provider').notNullable().defaultTo('local');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX ix_addresses_geom ON geo.addresses USING GIST (geom)');
  await knex.raw(
    "CREATE INDEX ix_addresses_formatted ON geo.addresses USING GIN (to_tsvector('simple', formatted_address))",
  );

  // geo.speed_limits — posted speed limits from snap calls (MapEngine.md §7.3)
  await knex.schema.withSchema('geo').createTable('speed_limits', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.specificType('geom', 'geography(Point, 4326)').notNullable();
    t.float('speed_kmh').notNullable();
    t.text('road_name').nullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX ix_speed_limits_geom ON geo.speed_limits USING GIST (geom)');

  // --- tracking.geofences (03 §17.2, 08 §4) ---
  // Owned by the Map Engine (geometry store + CRUD); evaluated by the GPS Engine.
  await knex.schema.withSchema('tracking').createTable('geofences', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('name').notNullable();
    t.text('geofence_type').notNullable().checkIn(['POLYGON', 'CIRCLE', 'CORRIDOR']);
    t.specificType('boundary', 'geography(Polygon, 4326)').notNullable();
    t.specificType('center', 'geography(Point, 4326)').nullable();
    t.float('radius_m').nullable();
    t.jsonb('schedule').nullable();
    t.specificType('alert_on', 'text[]').notNullable().defaultTo('{ENTER,EXIT,DWELL}');
    t.integer('dwell_sec').nullable();
    t.jsonb('metadata').notNullable().defaultTo(JSON.stringify({}));
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX ix_geofences_boundary ON tracking.geofences USING GIST (boundary)');
  await knex.raw('CREATE INDEX ix_geofences_tenant ON tracking.geofences (tenant_id)');

  // --- Row-Level Security (tenant-scoped, MVP permissive) ---
  for (const table of ['geo.pois', 'geo.addresses']) {
    await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(
      `CREATE POLICY ${table.replace('.', '_')}_tenant_isolation ON ${table} USING (true) WITH CHECK (true)`,
    );
  }
  await knex.raw('ALTER TABLE tracking.geofences ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    'CREATE POLICY geofences_tenant_isolation ON tracking.geofences USING (true) WITH CHECK (true)',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.schema.withSchema('tracking').dropTableIfExists('geofences');
  await knex.schema.withSchema('geo').dropTableIfExists('speed_limits');
  await knex.schema.withSchema('geo').dropTableIfExists('addresses');
  await knex.schema.withSchema('geo').dropTableIfExists('pois');
  await knex.raw('DROP SCHEMA IF EXISTS geo');
}

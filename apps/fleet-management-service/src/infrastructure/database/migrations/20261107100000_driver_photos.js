/**
 * Driver photos — who is driving, from the cabin camera.
 *
 * When a machine's ignition comes on (or its MDVR connects) the platform asks
 * the unit for a cabin snapshot (D03 → D00). Each snapshot is one row here:
 *
 *   status        capture pipeline: PENDING → CAPTURING → DOWNLOADING → READY | FAILED
 *   face_status   face-service result once READY: PENDING → FOUND | NO_FACE | ERROR
 *   match_status  who the photo belongs to:
 *                   UNASSIGNED — nobody yet (an operator files it)
 *                   AUTO       — the face matched a driver's confirmed photos
 *                   CONFIRMED  — an operator said which driver it is
 *
 * CONFIRMED photos are the reference set auto-matching compares against.
 * AUTO and CONFIRMED photos credit their driver with the shift the photo was
 * taken in (reporting-service haul shift reports).
 *
 * driver_id is not a foreign key: fleet.drivers is owned by fleet-service
 * migrations, which may run after this one.
 *
 * @param {import('knex').Knex} knex
 */
const PREDICATE = `(
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  OR COALESCE(NULLIF(current_setting('app.is_platform', true), '')::boolean, false)
)`;

export async function up(knex) {
  await knex.schema.withSchema('fleet').createTable('driver_photos', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('device_id').notNullable().references('id').inTable('fleet.devices').onDelete('CASCADE');
    t.uuid('vehicle_id');
    t.text('trigger').notNullable().checkIn(['IGNITION', 'CONNECT', 'MANUAL']);
    t.timestamp('triggered_at', { useTz: true }).notNullable();
    t.smallint('camera').notNullable();
    t.text('file_name');
    t.text('status')
      .notNullable()
      .defaultTo('PENDING')
      .checkIn(['PENDING', 'CAPTURING', 'DOWNLOADING', 'READY', 'FAILED']);
    t.timestamp('next_check_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.smallint('attempts').notNullable().defaultTo(0);
    t.uuid('capture_command_id');
    t.uuid('download_command_id');
    t.text('error');
    t.timestamp('captured_at', { useTz: true });
    t.binary('photo');
    t.text('face_status').checkIn(['PENDING', 'FOUND', 'NO_FACE', 'ERROR']);
    t.specificType('face_score', 'real');
    t.specificType('embedding', 'real[]');
    t.uuid('driver_id');
    t.text('match_status')
      .notNullable()
      .defaultTo('UNASSIGNED')
      .checkIn(['UNASSIGNED', 'AUTO', 'CONFIRMED']);
    t.specificType('match_score', 'real');
    t.timestamp('matched_at', { useTz: true });
    t.uuid('assigned_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    'CREATE INDEX fleet_driver_photos_tenant_time_idx ON fleet.driver_photos (tenant_id, triggered_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX fleet_driver_photos_tenant_driver_idx ON fleet.driver_photos (tenant_id, driver_id, match_status) WHERE driver_id IS NOT NULL',
  );
  await knex.raw(
    'CREATE INDEX fleet_driver_photos_vehicle_time_idx ON fleet.driver_photos (tenant_id, vehicle_id, captured_at) WHERE driver_id IS NOT NULL',
  );
  await knex.raw(
    "CREATE INDEX fleet_driver_photos_work_idx ON fleet.driver_photos (next_check_at) WHERE status IN ('PENDING', 'CAPTURING', 'DOWNLOADING') OR face_status = 'PENDING'",
  );
  await knex.raw(
    'CREATE INDEX fleet_driver_photos_device_time_idx ON fleet.driver_photos (device_id, triggered_at DESC)',
  );

  await knex.raw('ALTER TABLE fleet.driver_photos ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    `CREATE POLICY driver_photos_tenant_isolation ON fleet.driver_photos USING ${PREDICATE} WITH CHECK ${PREDICATE}`,
  );
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON fleet.driver_photos TO fleetvision_app, fleetvision_platform',
  );
}

export async function down(knex) {
  await knex.schema.withSchema('fleet').dropTableIfExists('driver_photos');
}

/**
 * Allow `teltonika` as a device protocol (FMB640 and the FMB/FMC family).
 *
 * `fleet.devices.protocol` is constrained to the device-gateway's adapter ids.
 * The original CHECK was created inline (no explicit name), so the constraint is
 * looked up by what it checks instead of assuming a name.
 *
 * @param {import('knex').Knex} knex
 */
const PROTOCOLS_NEW = ['gt06', 'jt808', 'meitrack', 'teltonika', 'stub'];
const PROTOCOLS_OLD = ['gt06', 'jt808', 'meitrack', 'stub'];

async function replaceProtocolCheck(knex, protocols) {
  const list = protocols.map((p) => `'${p}'`).join(', ');
  await knex.raw(`
    DO $$
    DECLARE c record;
    BEGIN
      FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'fleet.devices'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%protocol%'
      LOOP
        EXECUTE format('ALTER TABLE fleet.devices DROP CONSTRAINT %I', c.conname);
      END LOOP;
    END $$;
  `);
  await knex.raw(`
    ALTER TABLE fleet.devices
      ADD CONSTRAINT fleet_devices_protocol_check
      CHECK (protocol IN (${list}))
  `);
}

export async function up(knex) {
  await replaceProtocolCheck(knex, PROTOCOLS_NEW);
}

export async function down(knex) {
  await replaceProtocolCheck(knex, PROTOCOLS_OLD);
}

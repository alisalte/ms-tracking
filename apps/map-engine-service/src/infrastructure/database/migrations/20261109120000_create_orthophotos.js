/**
 * Drone orthophoto layers: one READY and at most one PROCESSING row per tenant.
 * The COG itself lives on the orthophoto volume, keyed by tenant + row id.
 *
 * @param {import("knex").Knex} knex
 */
const CTX = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";

export async function up(knex) {
  await knex.raw(`
    CREATE TABLE geo.orthophotos (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     uuid NOT NULL,
      original_name text NOT NULL,
      status        text NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
      error         text,
      min_lng       double precision,
      min_lat       double precision,
      max_lng       double precision,
      max_lat       double precision,
      min_zoom      integer,
      max_zoom      integer,
      cog_bytes     bigint,
      created_by    uuid,
      created_at    timestamptz NOT NULL DEFAULT now(),
      ready_at      timestamptz
    )
  `);
  await knex.raw(
    `CREATE UNIQUE INDEX orthophotos_one_ready ON geo.orthophotos (tenant_id) WHERE status = 'ready'`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX orthophotos_one_processing ON geo.orthophotos (tenant_id) WHERE status = 'processing'`,
  );
  await knex.raw('ALTER TABLE geo.orthophotos ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    `CREATE POLICY orthophotos_tenant_isolation ON geo.orthophotos USING (tenant_id = ${CTX}) WITH CHECK (tenant_id = ${CTX})`,
  );
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS geo.orthophotos');
}

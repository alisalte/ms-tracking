/**
 * Sprint C — fix the `audit.audit_entries.request_id` column type.
 *
 * The column was created as `uuid` (20260102000000_create_iam_schema.js), but a
 * request/correlation id (the `x-request-id` header / W3C traceparent) is an
 * arbitrary opaque string, NOT a uuid. identity-service never wrote audit entries
 * (the AuditRepository was unused), so the mismatch was latent. Sprint C is the
 * first service to record audit entries on every mutation, so this must be
 * corrected: a forward `ALTER … TYPE text` (nullable, uuid→text is a safe cast).
 *
 * `resource_id` stays `uuid` (every audited Sprint-C resource has a uuid id; the
 * binding audit records the device id as its resource id, with the vehicle id
 * carried in the `after` JSON).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    'ALTER TABLE audit.audit_entries ALTER COLUMN request_id TYPE text USING request_id::text',
  );
}

export async function down(knex) {
  await knex.raw(
    "ALTER TABLE audit.audit_entries ALTER COLUMN request_id TYPE uuid USING NULLIF(request_id, '')::uuid",
  );
}

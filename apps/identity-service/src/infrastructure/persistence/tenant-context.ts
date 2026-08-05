/**
 * Tenant-context helper — sets the PostgreSQL session variable
 * `app.current_tenant_id` inside a transaction so RLS policies (03 §3.3) filter
 * every statement to the caller's tenant. INV-I02: tenant_id is ALWAYS derived
 * from the verified principal, never the request body.
 *
 * The value is set per-transaction (`SET LOCAL`) so concurrent requests on the
 * pooled connection cannot leak tenant scope to each other. Platform operations
 * (tenant provisioning, audit writes) bypass this by passing a callback that
 * runs without the guard — they hold the platform (BYPASSRLS) role instead.
 */
import type { Knex } from '@fleetvision/persistence-knex';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Assert a value is a canonical UUID (makes SET LOCAL interpolation safe). */
function assertUuid(value: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Refusing to SET LOCAL a non-UUID tenant_id: ${value}`);
  }
}

/**
 * Run `fn` inside a knex transaction with the tenant context set. RLS policies
 * using `current_setting('app.current_tenant_id')` will scope automatically.
 *
 * NOTE: PostgreSQL's `SET LOCAL` does NOT accept bind parameters ($1), so the
 * tenant id is inlined after a strict UUID assertion (no injection surface).
 *
 * @returns whatever `fn` returns.
 */
export async function withTenantContext<T>(
  knex: Knex,
  tenantId: string,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  assertUuid(tenantId);
  return knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(trx);
  });
}

/**
 * Run `fn` in a transaction WITHOUT the tenant guard — for platform operations
 * (tenant provisioning, cross-tenant audit reads). The application role must be
 * permitted by the relevant (permissive-MVP) RLS policies.
 */
export async function withoutTenantContext<T>(
  knex: Knex,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return knex.transaction(async (trx) => fn(trx));
}

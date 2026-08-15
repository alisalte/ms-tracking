/**
 * Tenant-context helpers — set the PostgreSQL session variable
 * `app.current_tenant_id` inside a transaction so RLS policies (03 §3.3) filter
 * every statement to the caller's tenant. INV-I02: tenant_id is ALWAYS derived
 * from the verified authenticated context, never the request body.
 *
 * The value is set per-transaction (`SET LOCAL`) so concurrent requests on the
 * pooled connection cannot leak tenant scope to each other.
 *
 * NOTE (Sprint B): PostgreSQL RLS is currently NOT the enforcing boundary
 * because the application connects as the DB owner/superuser, which bypasses
 * RLS. Enforcement today is the authenticated repository-layer
 * `WHERE tenant_id = ?` filter. These helpers exist so that once a non-superuser
 * application role is introduced (future infra), hardened RLS policies using
 * `current_setting('app.current_tenant_id')` take effect with no code changes.
 *
 * `SET LOCAL` does NOT accept bind parameters ($1), so the tenant id is inlined
 * after a strict UUID assertion (no injection surface).
 */
import type { Knex } from './knex.factory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Assert a value is a canonical UUID (makes SET LOCAL interpolation safe). */
export function assertUuid(value: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Refusing to SET LOCAL a non-UUID tenant_id: ${value}`);
  }
}

/**
 * Run `fn` inside a knex transaction with the tenant context set. RLS policies
 * using `current_setting('app.current_tenant_id')` will scope automatically.
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
 * (tenant provisioning, cross-tenant admin reads).
 */
export async function withoutTenantContext<T>(
  knex: Knex,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return knex.transaction(async (trx) => fn(trx));
}

/**
 * Run `fn` as a platform operation — sets `app.is_platform = 'true'` so RLS
 * policies that branch on it allow cross-tenant access (tenant provisioning,
 * audit writes). Union addition from the merged parallel line; the app connects
 * as the owner today (RLS bypassed), so this is forward-ready plumbing.
 */
export async function withPlatformContext<T>(
  knex: Knex,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return knex.transaction(async (trx) => {
    await trx.raw("SET LOCAL app.is_platform = 'true'");
    return fn(trx);
  });
}

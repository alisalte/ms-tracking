/**
 * Tenant-context helpers — set the PostgreSQL session variables that the
 * tenant-aware RLS policies read on every statement. The variables are scoped to
 * the transaction (`SET LOCAL`) so concurrent requests on a pooled connection
 * cannot leak tenant scope to each other (INV-I02).
 *
 *   app.current_tenant_id  — the caller's tenant UUID (read by USING/WITH CHECK).
 *   app.is_platform        — 'true' when running a platform/cross-tenant
 *                            operation (provisioning, audit writes, cross-tenant
 *                            reads); grants the platform policy branch.
 *
 * The app role is `fleetvision_app` (NOBYPASSRLS) for ordinary requests and
 * `fleetvision_platform` (BYPASSRLS) for platform operations — both created by
 * the RLS hardening migration. Because the role already separates privileges,
 * `app.is_platform` is belt-and-braces for tables whose policy branches on it
 * (e.g. iam.tenants).
 *
 * NOTE: PostgreSQL's `SET LOCAL` does NOT accept bind parameters ($1), so the
 * tenant id is inlined after a strict UUID assertion (no injection surface).
 */
import type { Knex } from './knex.factory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOL_RE = /^(true|false)$/i;

/** Assert a value is a canonical UUID (makes SET LOCAL interpolation safe). */
export function assertUuid(value: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`Refusing to SET LOCAL a non-UUID tenant_id: ${value}`);
  }
}

/**
 * Run `fn` inside a knex transaction with the tenant context set. RLS policies
 * using `current_setting('app.current_tenant_id', true)` will scope automatically.
 */
export async function withTenantContext<T>(
  knex: Knex,
  tenantId: string,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  assertUuid(tenantId);
  return knex.transaction(async (trx) => {
    await trx.raw(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    await trx.raw("SET LOCAL app.is_platform = 'false'");
    return fn(trx);
  });
}

/**
 * Run `fn` in a transaction WITHOUT the tenant guard — for plain platform reads
 * where the role is already the platform (BYPASSRLS) client. Equivalent to
 * `withPlatformContext` but kept distinct for call-site readability when no
 * platform flag is needed (e.g. legacy identity read paths).
 */
export async function withoutTenantContext<T>(
  knex: Knex,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return knex.transaction(async (trx) => fn(trx));
}

/**
 * Run `fn` as a platform operation — sets `app.is_platform = 'true'` so policies
 * that branch on it (e.g. iam.tenants) allow cross-tenant access. The connection
 * must be the platform (BYPASSRLS) client for tables not guarded by app.is_platform.
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

/** Validate a boolean string for SET LOCAL (defense-in-depth). */
export function assertBoolString(value: string): void {
  if (!BOOL_RE.test(value)) {
    throw new Error(`Refusing to SET LOCAL a non-boolean: ${value}`);
  }
}

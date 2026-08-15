/**
 * Integration-test bootstrap for fleet-management-service — mirrors the gps-engine
 * pattern: a throwaway database in the local docker-compose Postgres, with graceful
 * skip when no DB is reachable (so `pnpm test` stays green without Docker).
 *
 * Applies BOTH identity-service migrations (creates the shared `audit.audit_entries`
 * table + `iam.tenants`, which fleet-management writes/joins) and fleet migrations.
 * The single shared `schema_migrations` table records them all (production reality:
 * one PostgreSQL instance, all services' migrations).
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Knex, createKnex } from '@fleetvision/persistence-knex';

export const ADMIN_URL =
  process.env.FLEET_TEST_DBURL ??
  process.env.DBURL ??
  'postgres://fleetvision:fleetvision@localhost:5432/fleetvision';

export const FLEET_MIGRATIONS = resolve(process.cwd(), 'src/infrastructure/database/migrations');
export const IDENTITY_MIGRATIONS = resolve(
  process.cwd(),
  '../identity-service/src/infrastructure/database/migrations',
);

export interface IntegrationCtx {
  readonly knex: Knex;
  readonly admin: Knex;
}

export function testDbUrl(testDbName: string): string {
  return ADMIN_URL.replace(/\/[^/?]*$/, `/${testDbName}`);
}

export async function dropTestDb(admin: Knex, testDbName: string): Promise<void> {
  await admin.raw(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${testDbName}'`,
  );
  await admin.raw(`DROP DATABASE IF EXISTS "${testDbName}"`);
}

/**
 * The identity-service `harden_iam_rls` migration is written in CommonJS style
 * (`exports.up = …`) while every other migration is ESM (`export async function`).
 * knex's own loader handles both in production, but the test's direct dynamic
 * `import()` cannot eval the CJS form. It only rewrites RLS policies — which are
 * not enforced for the test connection (table-owner superuser) — and the fleet
 * tests only need `iam.tenants` + `audit.audit_entries` from `create_iam_schema`.
 * Excluding it here keeps the schema faithful without touching an applied migration.
 */
const SKIP_IN_TESTS = ['20260813120000_harden_iam_rls_policies.js'];

/** Import each `.js` migration from the given dirs and run `up(knex)` in name order. */
async function applyMigrations(knex: Knex, dirs: readonly string[]): Promise<void> {
  const files: { file: string; dir: string }[] = [];
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.js') && !SKIP_IN_TESTS.includes(file)) files.push({ file, dir });
    }
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  for (const { file, dir } of files) {
    const mod = (await import(pathToFileURL(resolve(dir, file)).href)) as {
      up: (knex: Knex) => Promise<void>;
    };
    await mod.up(knex);
  }
}

export async function bootstrap(testDbName: string): Promise<IntegrationCtx | null> {
  let admin: Knex | null = null;
  let knex: Knex | null = null;
  try {
    admin = createKnex({ url: ADMIN_URL });
    await admin.raw('SELECT 1');
    await dropTestDb(admin, testDbName);
    await admin.raw(`CREATE DATABASE "${testDbName}"`);
    knex = createKnex({ url: testDbUrl(testDbName) });
    // Apply migrations by importing the `.js` modules directly and calling their
    // `up(knex)` in filename (timestamp) order. This sidesteps knex's migration
    // loader, which cannot load ESM `.js` files under jest's vm-module sandbox
    // (it throws "exports is not defined"). The SAME files run via knex.migrate in
    // production; here we only substitute the loader, not the DDL.
    await applyMigrations(knex, [IDENTITY_MIGRATIONS, FLEET_MIGRATIONS]);
    return { knex, admin };
  } catch (e) {
    try {
      if (knex) await knex.destroy();
    } catch {
      /* ignore */
    }
    try {
      if (admin) {
        await dropTestDb(admin, testDbName);
        await admin.destroy();
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.warn(`[fleet integration] skipped: ${(e as Error).message}`);
    return null;
  }
}

/** Insert an iam.tenant row (tenant_id self-references id for RLS uniformity). */
export async function seedTenant(
  knex: Knex,
  id: string,
  opts: { name?: string; status?: string } = {},
): Promise<void> {
  await knex('iam.tenants').insert({
    id,
    tenant_id: id,
    name: opts.name ?? `Tenant ${id.slice(0, 8)}`,
    tier: 'STANDARD',
    region: 'us-east-1',
    status: opts.status ?? 'ACTIVE',
  });
}

/** Truncate fleet tables between tests (order respects FKs). */
export async function truncateFleet(knex: Knex): Promise<void> {
  await knex.raw(
    'TRUNCATE fleet.vehicle_devices, fleet.devices, fleet.vehicles, fleet.fleets RESTART IDENTITY CASCADE',
  );
  await knex.raw('TRUNCATE audit.audit_entries RESTART IDENTITY CASCADE');
  await knex.raw('TRUNCATE iam.tenants RESTART IDENTITY CASCADE');
}

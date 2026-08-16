/**
 * Integration-test bootstrap for map-engine-service — a throwaway database in
 * the local docker-compose Postgres, with graceful skip when no DB is
 * reachable (so `pnpm test` stays green without Docker).
 *
 * Mirrors the gps-engine Sprint C pattern: migrations are applied by importing
 * the `.js` modules directly and calling `up(knex)` in filename order. The
 * CJS-style RLS-hardening migration is excluded (see SKIP_IN_TESTS — it only
 * rewrites policies that the owner-connected tests bypass anyway).
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Knex, createKnex } from '@fleetvision/persistence-knex';

export const ADMIN_URL =
  process.env.MAP_TEST_DBURL ??
  process.env.DBURL ??
  'postgres://fleetvision:fleetvision@localhost:5432/fleetvision';

export const MIGRATIONS_DIR = resolve(process.cwd(), 'src/infrastructure/database/migrations');

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

// Sprint I: the harden migration is now ESM (converted from CJS so knex's
// loader can run it — it had never applied cleanly anywhere before).
const SKIP_IN_TESTS: string[] = [];

/** Import each `.js` migration and run `up(knex)` in name order. */
export async function applyMigrations(knex: Knex, dir = MIGRATIONS_DIR): Promise<void> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.js') && !SKIP_IN_TESTS.includes(f));
  files.sort((a, b) => a.localeCompare(b));
  for (const file of files) {
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
    await knex.raw('CREATE EXTENSION IF NOT EXISTS postgis');
    await knex.raw('CREATE SCHEMA IF NOT EXISTS tracking');
    await applyMigrations(knex);
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
    console.warn(`[map-engine integration] skipped: ${(e as Error).message}`);
    return null;
  }
}

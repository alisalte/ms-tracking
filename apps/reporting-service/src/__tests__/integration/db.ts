/**
 * Integration-test bootstrap for reporting-service — a throwaway database in
 * the local docker-compose Postgres, with graceful skip when no DB is
 * reachable (mirrors the gps/map-engine pattern).
 *
 * Applies the reporting-relevant migrations by importing each `.js` module
 * directly and calling `up(knex)` in filename order:
 *   - gps-engine tracking schema (trips/idle/parking/positions + geofence state)
 *   - map-engine geo schema (tracking.geofences + Sprint I extensions)
 *   - notification schema (alerts + fleet_events) + Sprint J alerts index
 *   - fleet schema (vehicles/fleets)
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Knex, createKnex } from '@fleetvision/persistence-knex';

export const ADMIN_URL =
  process.env.REPORT_TEST_DBURL ??
  process.env.DBURL ??
  'postgres://fleetvision:fleetvision@localhost:15432/fleetvision';

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

/** Import each `.js` migration from another service's directory and run up(). */
export async function applyServiceMigrations(
  knex: Knex,
  serviceDir: string,
  skip: readonly string[] = [],
): Promise<void> {
  const dir = resolve(process.cwd(), `../${serviceDir}/src/infrastructure/database/migrations`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.js') && !skip.includes(f))
    .sort((a, b) => a.localeCompare(b));
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
    // CJS-style migrations the direct import cannot eval — policy-only rewrites
    // the tests bypass anyway (superuser connection), same as the other suites.
    await applyServiceMigrations(knex, 'gps-engine-service', [
      '20260813120000_harden_tracking_rls_policies.js',
    ]);
    await applyServiceMigrations(knex, 'map-engine-service', [
      '20260813120000_harden_geo_rls_policies.js',
    ]);
    // notification schema: apply the ordered subset (schema first, then others)
    const notifDir = resolve(
      process.cwd(),
      '../notification-service/src/infrastructure/database/migrations',
    );
    for (const file of [
      '20260301000000_create_notification_schema.js',
      '20260815100000_create_fleet_events.js',
      '20260816170000_add_alerts_tenant_raised_index.js',
    ]) {
      const mod = (await import(pathToFileURL(resolve(notifDir, file)).href)) as {
        up: (k: Knex) => Promise<void>;
      };
      await mod.up(knex);
    }
    await applyServiceMigrations(knex, 'fleet-management-service', []);
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
    console.warn(`[reporting integration] skipped: ${(e as Error).message}`);
    return null;
  }
}

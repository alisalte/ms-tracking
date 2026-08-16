/**
 * Integration-test bootstrap for notification-service — mirrors the
 * gps-engine Sprint C pattern: a throwaway database in the local
 * docker-compose Postgres, graceful skip when no DB is reachable.
 *
 * Applies the notification-service migrations + the map-engine geo migration
 * (tracking.geofences — the geofence alarm evaluation queries it cross-context,
 * exactly as production does).
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Knex, createKnex } from '@fleetvision/persistence-knex';

export const ADMIN_URL =
  process.env.NOTIF_TEST_DBURL ??
  process.env.DBURL ??
  'postgres://fleetvision:fleetvision@localhost:5432/fleetvision';

export const REDIS_URL = process.env.REDISURL ?? 'redis://localhost:6379';
export const KAFKA_BROKERS = process.env.NOTIF_KAFKA_BROKERS ?? 'localhost:9092';

export const MIGRATIONS_DIR = resolve(process.cwd(), 'src/infrastructure/database/migrations');
const MAP_ENGINE_GEO_MIGRATION = resolve(
  process.cwd(),
  '../map-engine-service/src/infrastructure/database/migrations/20260806120000_create_geo_schema.js',
);
const MAP_ENGINE_GEOFENCE_SPRINT_I_MIGRATION = resolve(
  process.cwd(),
  '../map-engine-service/src/infrastructure/database/migrations/20260816120000_extend_geofences_for_sprint_i.js',
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

/** Import each `.js` migration and run `up(knex)` in name order. */
async function applyMigrations(knex: Knex, dir = MIGRATIONS_DIR): Promise<void> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
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
    // notification schema + fleet_events
    await applyMigrations(knex);
    // tracking.geofences (map-engine-owned DDL — cross-context table the
    // geofence alarm evaluation queries in production).
    await knex.raw('CREATE SCHEMA IF NOT EXISTS tracking');
    const geo = (await import(pathToFileURL(MAP_ENGINE_GEO_MIGRATION).href)) as {
      up: (knex: Knex) => Promise<void>;
    };
    await geo.up(knex);
    // Sprint I — status/description columns + geofence_vehicles assignments.
    const sprintI = (await import(pathToFileURL(MAP_ENGINE_GEOFENCE_SPRINT_I_MIGRATION).href)) as {
      up: (knex: Knex) => Promise<void>;
    };
    await sprintI.up(knex);
    return { knex, admin };
  } catch (e) {
    if (process.env.NOTIF_TEST_DEBUG) {
      console.error('[integration bootstrap] failed:', e);
    }
    try {
      if (knex) await knex.destroy();
      if (admin) await admin.destroy();
    } catch {
      /* ignore */
    }
    return null; // no docker stack → graceful skip
  }
}

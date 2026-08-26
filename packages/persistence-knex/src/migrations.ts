/**
 * Migrations runner — applies pending knex migrations on boot, proving the
 * database path end-to-end (Sprint 1 plan Deliverable 2). Uses knex's built-in
 * migrator against a directory of timestamped migration modules. Production uses
 * Flyway (docs/specs/03_Database_Architecture.md §19); this is the dev/runtime path.
 */
import type { Knex } from './knex.factory.js';

/** Node syscall codes + Postgres SQLSTATEs that mean "retry, the server is not ready". */
const TRANSIENT_PG_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  '57P03', // cannot_connect_now ("the database system is starting up")
  '57P01', // admin_shutdown
]);

/**
 * True when a boot-time knex/pg error is a transient connectivity/recovery
 * failure rather than a real schema/auth problem. Used to wait-and-retry
 * instead of crashing the Nest process (which marks the container unhealthy
 * and aborts Compose dependents).
 */
export function isTransientPgError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e.code && TRANSIENT_PG_CODES.has(e.code)) return true;
  const message = (e.message ?? '').toLowerCase();
  return (
    message.includes('the database system is starting up') ||
    message.includes('the database system is in recovery mode') ||
    message.includes('the database system is shutting down') ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('connect econnrefused')
  );
}

export interface WaitForDatabaseOptions {
  /** Give up after this many ms. Default 90s — fits identity's 120s start_period. */
  timeoutMs?: number;
  logger?: { warn(message: string): void };
}

/**
 * Block until `SELECT 1` succeeds. Retries only transient connection/recovery
 * errors; auth, syntax, and other permanent failures throw immediately.
 */
export async function waitForDatabase(
  client: Knex,
  opts: WaitForDatabaseOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  let delayMs = 500;
  let attempt = 0;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      await client.raw('select 1 as ok');
      return;
    } catch (err) {
      lastErr = err;
      if (!isTransientPgError(err)) throw err;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const wait = Math.min(delayMs, remaining);
      opts.logger?.warn(
        `Postgres not ready (attempt ${attempt}): ${(err as Error).message} — retrying in ${wait}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
      delayMs = Math.min(delayMs * 2, 5_000);
    }
  }

  throw lastErr;
}

export interface MigrationsOptions {
  /** Absolute or cwd-relative directory holding the migration modules. */
  directory: string;
  /** Migration file extension knex should load ('.js' for ESM-built output). */
  extension?: 'js' | 'ts';
  /** Table name knex records applied migrations in. */
  tableName?: string;
}

/**
 * Apply all pending migrations. Logs progress and returns the list of newly
 * applied migration names (empty if the DB was already up to date).
 */
export async function runMigrations(client: Knex, opts: MigrationsOptions): Promise<string[]> {
  const [, applied] = await client.migrate.latest({
    directory: opts.directory,
    extension: opts.extension ?? 'js',
    tableName: opts.tableName ?? 'schema_migrations',
  });

  return applied as unknown as string[];
}

/** Roll back the most recent migration batch (used in tests / local dev). */
export async function rollbackLastBatch(client: Knex, opts: MigrationsOptions): Promise<void> {
  await client.migrate.rollback({
    directory: opts.directory,
    extension: opts.extension ?? 'js',
    tableName: opts.tableName ?? 'schema_migrations',
  });
}

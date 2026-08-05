/**
 * Migrations runner — applies pending knex migrations on boot, proving the
 * database path end-to-end (Sprint 1 plan Deliverable 2). Uses knex's built-in
 * migrator against a directory of timestamped migration modules. Production uses
 * Flyway (docs/specs/03_Database_Architecture.md §19); this is the dev/runtime path.
 */
import type { Knex } from './knex.factory.js';

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

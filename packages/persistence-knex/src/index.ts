/**
 * @fleetvision/persistence-knex — public surface.
 *
 * The relational gateway: a PgBouncer-aware knex client factory, a CRUD
 * `BaseRepository` for aggregate repositories to extend, a migrations runner,
 * and the `PersistenceModule` that wires it into the Nest graph.
 */
export {
  PersistenceModule,
  type PersistenceModuleOptions,
  KNEX_TOKEN,
  PLATFORM_KNEX_TOKEN,
} from './persistence.module.js';
export {
  createKnex,
  routesThroughPgBouncer,
  type KnexFactoryOptions,
  type Knex,
} from './knex.factory.js';
export { BaseRepository, type Row, type BaseRepositoryOptions } from './base.repository.js';
export {
  runMigrations,
  rollbackLastBatch,
  waitForDatabase,
  isTransientPgError,
  type MigrationsOptions,
  type WaitForDatabaseOptions,
} from './migrations.js';
export {
  assertUuid,
  withTenantContext,
  withoutTenantContext,
  withPlatformContext,
} from './tenant-context.js';

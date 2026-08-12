/**
 * @fleetvision/persistence-knex — public surface.
 *
 * The relational gateway: a PgBouncer-aware knex client factory, a CRUD
 * `BaseRepository` for aggregate repositories to extend, a migrations runner,
 * the tenant-context helpers (SET LOCAL for RLS), and the `PersistenceModule`
 * that wires it into the Nest graph.
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
export { runMigrations, rollbackLastBatch, type MigrationsOptions } from './migrations.js';
export {
  withTenantContext,
  withoutTenantContext,
  withPlatformContext,
  assertUuid,
  assertBoolString,
} from './tenant-context.js';

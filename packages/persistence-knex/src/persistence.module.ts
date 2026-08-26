/**
 * PersistenceModule — provides the knex client as a global injectable and runs
 * migrations on bootstrap (Sprint 1 plan Deliverable 2). Implements
 * `OnApplicationShutdown` so SIGTERM closes the pool gracefully (DoD #7).
 *
 * Usage:
 *   PersistenceModule.forRoot({ url: cfg.dbUrl, migrationsDirectory })
 */
import {
  type DynamicModule,
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Knex } from './knex.factory.js';
import { type KnexFactoryOptions, createKnex } from './knex.factory.js';
import { type MigrationsOptions, runMigrations, waitForDatabase } from './migrations.js';

export const KNEX_TOKEN = 'FLEETVISION_KNEX';
/**
 * A privileged knex client used to RUN migrations (DDL / role creation) and to
 * perform platform/cross-tenant operations (BYPASSRLS). The ordinary KNEX_TOKEN
 * connects as the non-superuser `fleetvision_app` role subject to tenant-aware
 * RLS; this token connects as `fleetvision_platform` (or the bootstrap superuser
 * in dev). Inject this ONLY into repositories/doctrine that legitimately need
 * platform scope (tenant provisioning, audit writes, cross-tenant reads).
 */
export const PLATFORM_KNEX_TOKEN = 'FLEETVISION_PLATFORM_KNEX';

export interface PersistenceModuleOptions {
  /** knex client factory options (connection URL, pool bounds, PgBouncer flag). */
  client: KnexFactoryOptions;
  /**
   * A privileged connection used to RUN migrations (DDL/role creation). When
   * omitted, migrations run on the ordinary `client` (dev only — the app role
   * cannot create roles/tables). In production this MUST point at a superuser
   * or role-creator connection separate from the runtime app role.
   */
  migrationsClient?: KnexFactoryOptions;
  /**
   * Optional platform (BYPASSRLS) client for cross-tenant operations. When
   * provided, it is exposed as PLATFORM_KNEX_TOKEN. When omitted, the ordinary
   * client is also bound to PLATFORM_KNEX_TOKEN (dev/single-role fallback).
   */
  platformClient?: KnexFactoryOptions;
  /**
   * Migrations directory. When provided, pending migrations run on bootstrap.
   * Omit to skip auto-migration (e.g. in short-lived test fixtures).
   */
  migrations?: MigrationsOptions;
  /** When true, swallow migration errors at boot (tests). Default false. */
  skipMigrationsOnError?: boolean;
}

@Global()
@Module({})
export class PersistenceModule implements OnApplicationShutdown {
  private readonly logger = new Logger(PersistenceModule.name);

  public static forRoot(options: PersistenceModuleOptions): DynamicModule {
    const client = createKnex(options.client);
    // Migrations run on the privileged client when provided; otherwise the
    // ordinary client (dev/single-role). The privileged client is destroyed
    // after migrations to avoid holding a second pool open for the app lifetime.
    const migrationsKnex = options.migrationsClient ? createKnex(options.migrationsClient) : client;
    // Optional platform (BYPASSRLS) client for cross-tenant operations.
    const platformKnex = options.platformClient ? createKnex(options.platformClient) : client;

    const clientProvider = {
      provide: KNEX_TOKEN,
      useValue: client,
    };
    const platformProvider = {
      provide: PLATFORM_KNEX_TOKEN,
      useValue: platformKnex,
    };

    // Run migrations eagerly so the DB is ready before the HTTP server starts.
    // An async factory provider guarantees ordering without a dedicated lifecycle hook.
    const migrationsProvider = {
      provide: 'FLEETVISION_MIGRATIONS_BOOTSTRAP',
      useFactory: async () => {
        if (options.migrations) {
          try {
            const log = new Logger(PersistenceModule.name);
            await waitForDatabase(migrationsKnex, { logger: log });
            const applied = await runMigrations(migrationsKnex, options.migrations);
            if (applied.length > 0) {
              log.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
            } else {
              log.log('Migrations up to date — nothing to apply.');
            }
          } catch (err) {
            if (options.skipMigrationsOnError) {
              new Logger(PersistenceModule.name).warn(
                `Migrations skipped due to error: ${(err as Error).message}`,
              );
              return;
            }
            throw err;
          } finally {
            // Close the privileged migrations client if it was a separate pool.
            if (options.migrationsClient) {
              await migrationsKnex.destroy().catch(() => {});
            }
          }
        }
      },
    };

    return {
      module: PersistenceModule,
      global: true,
      providers: [clientProvider, platformProvider, migrationsProvider],
      exports: [KNEX_TOKEN, PLATFORM_KNEX_TOKEN],
    };
  }

  constructor(
    @Inject(KNEX_TOKEN) private readonly client: Knex,
    @Inject(PLATFORM_KNEX_TOKEN) private readonly platformClient: Knex,
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing knex pool (graceful shutdown).');
    await this.client.destroy();
    // Only destroy the platform client if it's a distinct pool.
    if (this.platformClient !== this.client) {
      await this.platformClient.destroy().catch(() => {});
    }
  }
}

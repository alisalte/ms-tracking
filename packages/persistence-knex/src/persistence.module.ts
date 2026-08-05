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
import { type MigrationsOptions, runMigrations } from './migrations.js';

export const KNEX_TOKEN = 'FLEETVISION_KNEX';

export interface PersistenceModuleOptions {
  /** knex client factory options (connection URL, pool bounds, PgBouncer flag). */
  client: KnexFactoryOptions;
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

    const clientProvider = {
      provide: KNEX_TOKEN,
      useValue: client,
    };

    // Run migrations eagerly so the DB is ready before the HTTP server starts.
    // An async factory provider guarantees ordering without a dedicated lifecycle hook.
    const migrationsProvider = {
      provide: 'FLEETVISION_MIGRATIONS_BOOTSTRAP',
      useFactory: async () => {
        if (options.migrations) {
          try {
            const applied = await runMigrations(client, options.migrations);
            const log = new Logger(PersistenceModule.name);
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
          }
        }
      },
    };

    return {
      module: PersistenceModule,
      global: true,
      providers: [clientProvider, migrationsProvider],
      exports: [KNEX_TOKEN],
    };
  }

  constructor(@Inject(KNEX_TOKEN) private readonly client: Knex) {}

  public async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing knex pool (graceful shutdown).');
    await this.client.destroy();
  }
}

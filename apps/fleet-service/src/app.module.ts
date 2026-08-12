/**
 * AppModule — composition root for fleet-service.
 */
import { join } from 'node:path';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { FleetModule } from './api/fleet.module.js';
import { type FleetConfig, fleetConfigSchema } from './config/fleet.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: FleetConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          schema: fleetConfigSchema,
          serviceName: 'fleet-service',
          env: process.env,
        }),
        LoggerModule.forRootFromConfig(config as BaseConfig),
        PersistenceModule.forRoot({
          client: { url: config.DBURL },
          migrationsClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          platformClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        HealthModule,
        FleetModule.forRoot(config),
      ],
    };
  }
}

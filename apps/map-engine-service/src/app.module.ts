/**
 * AppModule — composition root for map-engine-service.
 *
 * Wires the cross-cutting modules (config → logger → persistence → redis →
 * health) in dependency order, then the MapEngineModule (spatial queries,
 * clustering, replay, geofences, POIs, provider abstraction, REST API).
 */
import { join } from 'node:path';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { MapEngineModule } from './api/map-engine.module.js';
import { type MapEngineConfig, mapEngineConfigSchema } from './config/map-engine.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: MapEngineConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          schema: mapEngineConfigSchema,
          serviceName: 'map-engine-service',
          env: process.env,
        }),
        LoggerModule.forRootFromConfig(config as BaseConfig),
        PersistenceModule.forRoot({
          client: { url: config.DBURL },
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        HealthModule,
        MapEngineModule.forRoot(config),
      ],
    };
  }
}

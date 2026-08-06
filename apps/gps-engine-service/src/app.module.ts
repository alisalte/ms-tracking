/**
 * AppModule — the composition root for gps-engine-service.
 *
 * Wires the cross-cutting modules (config → logger → persistence → redis →
 * health) in dependency order, then the GpsEngineModule (Kafka position consumer,
 * session-lifecycle consumer, position pipeline, Redis caches, WebSocket
 * broadcaster, REST API). Migrations run eagerly inside PersistenceModule before
 * the HTTP server starts.
 */
import { join } from 'node:path';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { GpsEngineModule } from './api/gps-engine.module.js';
import { type GpsEngineConfig, gpsEngineConfigSchema } from './config/gps-engine.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: GpsEngineConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          schema: gpsEngineConfigSchema,
          serviceName: 'gps-engine-service',
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
        GpsEngineModule.forRoot(config),
      ],
    };
  }
}

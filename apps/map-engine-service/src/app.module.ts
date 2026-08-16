/**
 * AppModule — composition root for map-engine-service.
 *
 * Wires the cross-cutting modules (config → logger → persistence → redis →
 * health) in dependency order, then the MapEngineModule (spatial queries,
 * clustering, replay, geofences, POIs, provider abstraction, REST API).
 */
import { join } from 'node:path';
import { AuthModule } from '@fleetvision/auth';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule, MetricsModule } from '@fleetvision/observability';
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
            // Per-service migration ledger (Sprint I docker verification
            // finding): the shared dev database records identity-service's
            // migrations in the default `schema_migrations` table — a shared
            // ledger makes map-engine's container crash at boot ("relation
            // schema_migrations already exists"). Same convention as
            // notification-service.
            tableName: 'map_engine_schema_migrations',
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        // Sprint B: JWT/API-key auth + global CompositeAuthGuard + PermissionsGuard.
        AuthModule.forRoot({
          jwt: {
            JWT_SECRET: config.JWT_SECRET,
            JWT_ISSUER: config.JWT_ISSUER,
            JWT_AUDIENCE: config.JWT_AUDIENCE,
          },
        }),
        // Sprint I: Prometheus metrics (geofence mutations + map-match outcomes).
        MetricsModule.forRoot({
          telemetry: { prefix: 'fleetvision' },
          exposeEndpoint: config.MAP_METRICS_ENABLED,
        }),
        HealthModule.forRoot(),
        MapEngineModule.forRoot(config),
      ],
    };
  }
}

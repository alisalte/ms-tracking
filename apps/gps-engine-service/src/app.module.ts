/**
 * AppModule — the composition root for gps-engine-service.
 *
 * Wires the cross-cutting modules (config → logger → persistence → redis →
 * health → metrics) in dependency order, then the GpsEngineModule (Kafka
 * position consumer + DLQ, session-lifecycle consumer, position pipeline, Redis
 * caches, WebSocket broadcaster, REST API). Migrations run eagerly inside
 * PersistenceModule before the HTTP server starts.
 *
 * Sprint D: /metrics (Prometheus) + Kafka-consumer readiness (§33/§35). The
 * same GpsEngineModule instance is passed to HealthModule.forRoot so its
 * exported readiness indicators are injectable there (Nest instantiates it once).
 */
import { join } from 'node:path';
import { AuthModule } from '@fleetvision/auth';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule, MetricsModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { GpsEngineModule } from './api/gps-engine.module.js';
import { type GpsEngineConfig, gpsEngineConfigSchema } from './config/gps-engine.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: GpsEngineConfig): DynamicModule {
    const engineModule = GpsEngineModule.forRoot(config);
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
          // Migrations run via the privileged platform connection — the app
          // role cannot CREATE the tracking schema/tables/ledger on hardened
          // stacks (RLS model: app = DML-only, platform = DDL/BYPASSRLS).
          migrationsClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
            // Per-service migration ledger (Sprint I convention — see
            // map-engine/notification): the shared dev database's default
            // `schema_migrations` table belongs to identity-service.
            tableName: 'gps_engine_schema_migrations',
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
        // Sprint D §33 — Prometheus /metrics endpoint.
        MetricsModule.forRoot({
          telemetry: { prefix: 'fleetvision' },
          exposeEndpoint: config.GPS_METRICS_ENABLED,
        }),
        // Sprint D §35 — readiness includes the Kafka consumer (via the SAME
        // engine module instance, whose indicators are exported).
        HealthModule.forRoot({ imports: [engineModule] }),
        engineModule,
      ],
    };
  }
}

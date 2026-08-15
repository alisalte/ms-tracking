/**
 * AppModule — composition root for notification-service.
 *
 * Wires cross-cutting modules (config → logger → persistence → redis → health)
 * in dependency order, then the NotificationModule (Kafka consumer, alarm
 * evaluator, repositories, WS gateway, REST API). Migrations run eagerly inside
 * PersistenceModule before the HTTP server starts.
 */
import { join } from 'node:path';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule, MetricsModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { NotificationModule } from './api/notification.module.js';
import { type NotificationConfig, notificationConfigSchema } from './config/notification.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: NotificationConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          schema: notificationConfigSchema,
          serviceName: 'notification-service',
          env: process.env,
        }),
        LoggerModule.forRootFromConfig(config as BaseConfig),
        PersistenceModule.forRoot({
          client: { url: config.DBURL },
          // Migrations run via a privileged connection (creates the notification schema + RLS).
          migrationsClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          platformClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
            // Per-service migration ledger: the shared dev database records
            // identity-service's migrations in the default `schema_migrations`
            // table — a shared ledger makes knex reject this directory as
            // "corrupt". Each service tracks its own applied set.
            tableName: 'notification_schema_migrations',
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        // Sprint G Part 36 — Prometheus /metrics (events/alarms/dlq counters).
        MetricsModule.forRoot({
          telemetry: { prefix: 'fleetvision' },
          exposeEndpoint: config.NOTIF_METRICS_ENABLED,
        }),
        HealthModule,
        NotificationModule.forRoot(config),
      ],
    };
  }
}

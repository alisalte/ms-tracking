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
import { LoggerModule } from '@fleetvision/observability';
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
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        HealthModule,
        NotificationModule.forRoot(config),
      ],
    };
  }
}

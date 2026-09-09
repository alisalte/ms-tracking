/**
 * AppModule — composition root for reporting-service.
 *
 * Analytical read layer over shared PostgreSQL (tracking + notification +
 * fleet) plus the reporting schema for schedule/job metadata (Phase 1 / F-05).
 */
import { join } from 'node:path';
import { AuthModule } from '@fleetvision/auth';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule, MetricsModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { ReportingModule } from './api/reporting.module.js';
import { type ReportingConfig, reportingConfigSchema } from './config/reporting.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: ReportingConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          schema: reportingConfigSchema,
          serviceName: 'reporting-service',
          env: process.env,
        }),
        LoggerModule.forRootFromConfig(config as BaseConfig),
        PersistenceModule.forRoot({
          client: { url: config.DBURL },
          migrationsClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          platformClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
            tableName: 'reporting_schema_migrations',
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        AuthModule.forRoot({
          jwt: {
            JWT_SECRET: config.JWT_SECRET,
            JWT_ISSUER: config.JWT_ISSUER,
            JWT_AUDIENCE: config.JWT_AUDIENCE,
          },
        }),
        MetricsModule.forRoot({
          telemetry: { prefix: 'fleetvision' },
          exposeEndpoint: config.REPORT_METRICS_ENABLED,
        }),
        HealthModule.forRoot(),
        ReportingModule.forRoot(config),
      ],
    };
  }
}

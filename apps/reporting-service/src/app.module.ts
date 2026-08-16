/**
 * AppModule — composition root for reporting-service.
 *
 * The analytical read layer over the shared PostgreSQL (tracking +
 * notification + fleet schemas, read-only) with Redis caching/export rate
 * limiting. No migrations of its own (schema is owned by the domain services;
 * Sprint J only added indexes THROUGH those services).
 */
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
        // Read-only analytical access via the app role (the house pattern:
        // repository-level tenant WHERE is the enforcing boundary; the
        // reporting layer adds READ ONLY transactions + statement timeouts).
        PersistenceModule.forRoot({
          client: { url: config.DBURL },
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

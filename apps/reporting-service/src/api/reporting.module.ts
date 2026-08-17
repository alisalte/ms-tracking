/**
 * ReportingModule — wires the reporting-service components (factory-forRoot
 * house pattern).
 */
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { METRICS_TOKEN, type TelemetryMetrics } from '@fleetvision/observability';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { ReportService } from '../application/report.service.js';
import type { ReportingConfig } from '../config/reporting.config.js';
import { ExportRateLimiter, ReportCache } from '../infrastructure/cache/report-cache.js';
import { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import { ReportRepository } from '../infrastructure/persistence/report.repository.js';
import { ReportsController } from './reports.controller.js';
import {
  EXPORT_RATE_LIMITER,
  REPORTING_CONFIG,
  REPORT_AUDIT_REPOSITORY,
  REPORT_CACHE,
  REPORT_REPOSITORY,
  REPORT_SERVICE,
} from './tokens.js';

@Module({})
export class ReportingModule {
  public static forRoot(config: ReportingConfig): DynamicModule {
    const providers: Provider[] = [
      { provide: REPORTING_CONFIG, useValue: config },
      {
        provide: REPORT_REPOSITORY,
        inject: [KNEX_TOKEN],
        useFactory: (knex: unknown) =>
          new ReportRepository({
            knex: knex as never,
            queryTimeoutMs: config.REPORT_QUERY_TIMEOUT_MS,
          }),
      },
      {
        provide: REPORT_CACHE,
        inject: [REDIS_TOKEN],
        useFactory: (redis: Redis) => new ReportCache(redis, config.REPORT_CACHE_TTL_SECONDS),
      },
      {
        provide: EXPORT_RATE_LIMITER,
        inject: [REDIS_TOKEN],
        useFactory: (redis: Redis) =>
          new ExportRateLimiter(
            redis,
            config.REPORT_EXPORT_RATE_LIMIT,
            config.REPORT_EXPORT_RATE_WINDOW_SECONDS,
          ),
      },
      {
        provide: REPORT_AUDIT_REPOSITORY,
        inject: [KNEX_TOKEN],
        useFactory: (knex: unknown) => new AuditRepository(knex as never),
      },
      {
        provide: REPORT_SERVICE,
        inject: [
          REPORTING_CONFIG,
          REPORT_REPOSITORY,
          REPORT_CACHE,
          EXPORT_RATE_LIMITER,
          REPORT_AUDIT_REPOSITORY,
          METRICS_TOKEN,
        ],
        useFactory: (
          cfg: ReportingConfig,
          repo: ReportRepository,
          cache: ReportCache,
          limiter: ExportRateLimiter,
          audit: AuditRepository,
          metrics: TelemetryMetrics,
        ) =>
          new ReportService({
            config: cfg,
            repository: repo,
            cache,
            exportLimiter: limiter,
            audit,
            metrics,
          }),
      },
      ReportsController,
    ];
    return {
      module: ReportingModule,
      providers,
      controllers: [ReportsController],
    };
  }
}

/**
 * ReportingModule — wires the reporting-service components (factory-forRoot
 * house pattern).
 */
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { METRICS_TOKEN, type TelemetryMetrics } from '@fleetvision/observability';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { OperationsReportService } from '../application/operations-report.service.js';
import { ReportScheduleService } from '../application/report-schedule.service.js';
import { ReportScheduleWorker } from '../application/report-schedule.worker.js';
import { ReportService } from '../application/report.service.js';
import { TenantEmailSettingsService } from '../application/tenant-email-settings.service.js';
import type { ReportingConfig } from '../config/reporting.config.js';
import { ExportRateLimiter, ReportCache } from '../infrastructure/cache/report-cache.js';
import { SecretBox } from '../infrastructure/crypto/secret-box.js';
import { type ReportMailer, TenantSmtpReportMailer } from '../infrastructure/mail/report-mailer.js';
import { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import { ReportScheduleRepository } from '../infrastructure/persistence/report-schedule.repository.js';
import { ReportRepository } from '../infrastructure/persistence/report.repository.js';
import { TenantEmailSettingsRepository } from '../infrastructure/persistence/tenant-email-settings.repository.js';
import { OperationsReportsController } from './operations-reports.controller.js';
import { PlatformEmailSettingsController } from './platform-email-settings.controller.js';
import { ReportSchedulesController } from './report-schedules.controller.js';
import { ReportsController } from './reports.controller.js';
import {
  EXPORT_RATE_LIMITER,
  OPERATIONS_REPORT_SERVICE,
  REPORTING_CONFIG,
  REPORT_AUDIT_REPOSITORY,
  REPORT_CACHE,
  REPORT_MAILER,
  REPORT_REPOSITORY,
  REPORT_SCHEDULE_REPOSITORY,
  REPORT_SCHEDULE_SERVICE,
  REPORT_SCHEDULE_WORKER,
  REPORT_SERVICE,
  SECRET_BOX,
  TENANT_EMAIL_SETTINGS_REPOSITORY,
  TENANT_EMAIL_SETTINGS_SERVICE,
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
      {
        provide: REPORT_SCHEDULE_REPOSITORY,
        inject: [KNEX_TOKEN],
        useFactory: (knex: unknown) => new ReportScheduleRepository(knex as never),
      },
      { provide: SECRET_BOX, useFactory: () => new SecretBox(config.REPORT_SECRETS_KEY) },
      {
        provide: TENANT_EMAIL_SETTINGS_REPOSITORY,
        inject: [KNEX_TOKEN],
        useFactory: (knex: unknown) => new TenantEmailSettingsRepository(knex as never),
      },
      {
        provide: REPORT_MAILER,
        inject: [TENANT_EMAIL_SETTINGS_REPOSITORY, SECRET_BOX],
        useFactory: (settings: TenantEmailSettingsRepository, secrets: SecretBox) =>
          new TenantSmtpReportMailer(
            settings,
            secrets,
            config.REPORT_SMTP_HOST && config.REPORT_SMTP_FROM
              ? {
                  host: config.REPORT_SMTP_HOST,
                  port: config.REPORT_SMTP_PORT,
                  secure: config.REPORT_SMTP_SECURE,
                  user: config.REPORT_SMTP_USER ?? '',
                  pass: config.REPORT_SMTP_PASS ?? '',
                  from: config.REPORT_SMTP_FROM,
                }
              : null,
          ),
      },
      {
        provide: TENANT_EMAIL_SETTINGS_SERVICE,
        inject: [TENANT_EMAIL_SETTINGS_REPOSITORY, SECRET_BOX, REPORT_MAILER],
        useFactory: (
          repo: TenantEmailSettingsRepository,
          secrets: SecretBox,
          mailer: ReportMailer,
        ) => new TenantEmailSettingsService(repo, secrets, mailer),
      },
      {
        provide: REPORT_SCHEDULE_SERVICE,
        inject: [
          REPORT_SCHEDULE_REPOSITORY,
          REPORT_SERVICE,
          REPORT_MAILER,
          OPERATIONS_REPORT_SERVICE,
        ],
        useFactory: (
          schedules: ReportScheduleRepository,
          reports: ReportService,
          mailer: ReportMailer,
          operations: OperationsReportService,
        ) => new ReportScheduleService({ schedules, reports, mailer, operations }),
      },
      {
        provide: REPORT_SCHEDULE_WORKER,
        inject: [REPORT_SCHEDULE_SERVICE],
        useFactory: (schedules: ReportScheduleService) =>
          new ReportScheduleWorker({
            schedules,
            intervalMs: config.REPORT_SCHEDULE_WORKER_INTERVAL_MS,
            batchSize: config.REPORT_SCHEDULE_WORKER_BATCH_SIZE,
          }),
      },
      {
        provide: OPERATIONS_REPORT_SERVICE,
        inject: [KNEX_TOKEN, REPORTING_CONFIG],
        useFactory: (knex: unknown, cfg: ReportingConfig) =>
          new OperationsReportService(knex as never, cfg.REPORT_QUERY_TIMEOUT_MS),
      },
      ReportsController,
      OperationsReportsController,
      ReportSchedulesController,
      PlatformEmailSettingsController,
    ];
    return {
      module: ReportingModule,
      providers,
      controllers: [
        ReportsController,
        OperationsReportsController,
        ReportSchedulesController,
        PlatformEmailSettingsController,
      ],
    };
  }
}

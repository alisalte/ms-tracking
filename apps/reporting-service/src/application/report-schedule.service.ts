/**
 * Report schedule application service — CRUD + run-now + worker execution.
 */
import { Logger } from '@nestjs/common';
import { buildReportEmail } from '../domain/report-email.js';
import {
  MAX_SCHEDULE_ROUTES,
  type ReportJob,
  type ReportSchedule,
  type SchedulableReport,
  type ScheduleCadence,
  type SchedulePreset,
  computeNextRunAt,
  isSchedulableReport,
  isScheduleCadence,
  isSchedulePreset,
  normalizeRecipients,
  reportNeedsRoute,
} from '../domain/report-schedule.js';
import { XLSX_MIME } from '../domain/xlsx.js';
import type { ReportMailer } from '../infrastructure/mail/report-mailer.js';
import type { ReportScheduleRepository } from '../infrastructure/persistence/report-schedule.repository.js';
import type { OperationsReportService } from './operations-report.service.js';
import type { ReportService } from './report.service.js';

/** A finished report file: CSV text, or the bytes of an .xlsx workbook. */
interface ReportArtifact {
  readonly filename: string;
  readonly rows: number;
  readonly csv?: string;
  readonly bytes?: Uint8Array;
}

export class ReportScheduleInputError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_INPUT' | 'NOT_FOUND' = 'INVALID_INPUT',
  ) {
    super(message);
    this.name = 'ReportScheduleInputError';
  }
}

export interface CreateScheduleInput {
  name: string;
  reportType: string;
  cadence: string;
  preset?: string;
  routeId?: string | null;
  /** 'haul-shifts' only: several routes read as one work day. */
  routeIds?: string[];
  enabled?: boolean;
  recipients?: string[];
}

export interface UpdateScheduleInput {
  name?: string;
  cadence?: string;
  preset?: string;
  routeId?: string | null;
  routeIds?: string[];
  enabled?: boolean;
  recipients?: string[];
}

export interface ReportScheduleServiceDeps {
  readonly schedules: ReportScheduleRepository;
  readonly reports: ReportService;
  /** Needed for 'haul-cycles' and 'haul-shifts' schedules. */
  readonly operations?: OperationsReportService;
  readonly mailer: ReportMailer;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Distinct route ids, 1 to MAX_SCHEDULE_ROUTES of them. */
function parseRouteIds(input: readonly string[]): string[] {
  const ids = [...new Set(input.map((id) => id.trim()).filter(Boolean))];
  if (
    ids.length === 0 ||
    ids.length > MAX_SCHEDULE_ROUTES ||
    !ids.every((id) => UUID_RE.test(id))
  ) {
    throw new ReportScheduleInputError(
      `routeIds must be 1 to ${MAX_SCHEDULE_ROUTES} haul route ids`,
    );
  }
  return ids;
}

function parseRecipients(input: string[]): string[] {
  const list = normalizeRecipients(input);
  if (!list) {
    throw new ReportScheduleInputError('recipients must be up to 10 valid email addresses');
  }
  return list;
}

function toApiSchedule(s: ReportSchedule) {
  return {
    id: s.id,
    name: s.name,
    reportType: s.reportType,
    cadence: s.cadence,
    preset: s.preset,
    routeId: s.routeId,
    routeIds: s.routeIds,
    enabled: s.enabled,
    recipients: s.recipients,
    nextRunAt: s.nextRunAt.toISOString(),
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function toApiJob(j: ReportJob) {
  return {
    id: j.id,
    scheduleId: j.scheduleId,
    reportType: j.reportType,
    status: j.status,
    filename: j.filename,
    rowCount: j.rowCount,
    error: j.error,
    emailStatus: j.emailStatus,
    emailError: j.emailError,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    downloadable: j.status === 'SUCCEEDED',
  };
}

export class ReportScheduleService {
  private readonly logger = new Logger(ReportScheduleService.name);

  constructor(private readonly deps: ReportScheduleServiceDeps) {}

  public async list(tenantId: string) {
    const items = await this.deps.schedules.listSchedules(tenantId);
    return { items: items.map(toApiSchedule) };
  }

  public async create(tenantId: string, userId: string | null, input: CreateScheduleInput) {
    const name = input.name?.trim();
    if (!name || name.length > 120) {
      throw new ReportScheduleInputError('name is required (max 120 chars)');
    }
    if (!isSchedulableReport(input.reportType)) {
      throw new ReportScheduleInputError(
        'reportType must be trips | vehicle-utilization | alarms | haul-cycles | haul-shifts',
      );
    }
    const needsRoute = reportNeedsRoute(input.reportType);
    const routeIds =
      input.reportType === 'haul-shifts'
        ? parseRouteIds([...(input.routeIds ?? []), ...(input.routeId ? [input.routeId] : [])])
        : [];
    const routeId = needsRoute ? (routeIds[0] ?? input.routeId ?? null) : null;
    if (needsRoute && !routeId) {
      throw new ReportScheduleInputError(`routeId is required for ${input.reportType} schedules`);
    }
    if (!isScheduleCadence(input.cadence)) {
      throw new ReportScheduleInputError('cadence must be daily | weekly');
    }
    const preset = input.preset ?? '7d';
    if (!isSchedulePreset(preset)) {
      throw new ReportScheduleInputError('preset must be today | yesterday | 7d | 30d');
    }
    const schedule = await this.deps.schedules.insertSchedule({
      tenantId,
      name,
      reportType: input.reportType,
      cadence: input.cadence,
      preset,
      routeId,
      routeIds,
      enabled: input.enabled !== false,
      recipients: parseRecipients(input.recipients ?? []),
      // Due immediately so the worker (or run-now) produces the first artifact.
      nextRunAt: new Date(),
      createdBy: userId,
    });
    return toApiSchedule(schedule);
  }

  public async update(tenantId: string, id: string, input: UpdateScheduleInput) {
    const existing = await this.deps.schedules.getSchedule(tenantId, id);
    if (!existing) throw new ReportScheduleInputError('Schedule not found', 'NOT_FOUND');

    const patch: {
      name?: string;
      cadence?: ScheduleCadence;
      preset?: SchedulePreset;
      routeId?: string | null;
      routeIds?: string[];
      enabled?: boolean;
      recipients?: string[];
      nextRunAt?: Date;
    } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 120) {
        throw new ReportScheduleInputError('name is required (max 120 chars)');
      }
      patch.name = name;
    }
    if (input.cadence !== undefined) {
      if (!isScheduleCadence(input.cadence)) {
        throw new ReportScheduleInputError('cadence must be daily | weekly');
      }
      patch.cadence = input.cadence;
    }
    if (input.preset !== undefined) {
      if (!isSchedulePreset(input.preset)) {
        throw new ReportScheduleInputError('preset must be today | yesterday | 7d | 30d');
      }
      patch.preset = input.preset;
    }
    if (input.routeId !== undefined) {
      if (!reportNeedsRoute(existing.reportType) || !input.routeId) {
        throw new ReportScheduleInputError('routeId applies to haul route schedules only');
      }
      patch.routeId = input.routeId;
      if (existing.reportType === 'haul-shifts' && input.routeIds === undefined) {
        patch.routeIds = [input.routeId];
      }
    }
    if (input.routeIds !== undefined) {
      if (existing.reportType !== 'haul-shifts') {
        throw new ReportScheduleInputError('routeIds applies to haul-shifts schedules only');
      }
      patch.routeIds = parseRouteIds(input.routeIds);
      patch.routeId = patch.routeIds[0] ?? null;
    }
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.recipients !== undefined) patch.recipients = parseRecipients(input.recipients);

    const updated = await this.deps.schedules.updateSchedule(tenantId, id, patch);
    if (!updated) throw new ReportScheduleInputError('Schedule not found', 'NOT_FOUND');
    return toApiSchedule(updated);
  }

  public async remove(tenantId: string, id: string): Promise<void> {
    const ok = await this.deps.schedules.deleteSchedule(tenantId, id);
    if (!ok) throw new ReportScheduleInputError('Schedule not found', 'NOT_FOUND');
  }

  public async listJobs(tenantId: string, scheduleId: string) {
    const schedule = await this.deps.schedules.getSchedule(tenantId, scheduleId);
    if (!schedule) throw new ReportScheduleInputError('Schedule not found', 'NOT_FOUND');
    const items = await this.deps.schedules.listJobs(tenantId, scheduleId);
    return { items: items.map(toApiJob) };
  }

  public async downloadJob(
    tenantId: string,
    jobId: string,
  ): Promise<{ content: string | Uint8Array; contentType: string; filename: string }> {
    const job = await this.deps.schedules.getJobWithArtifact(tenantId, jobId);
    if (!job) throw new ReportScheduleInputError('Job not found', 'NOT_FOUND');
    if (job.status === 'SUCCEEDED' && job.artifactBytes) {
      return {
        content: job.artifactBytes,
        contentType: XLSX_MIME,
        filename: job.filename ?? `${job.reportType}-scheduled.xlsx`,
      };
    }
    if (job.status !== 'SUCCEEDED' || !job.artifactCsv) {
      throw new ReportScheduleInputError('Job has no downloadable artifact');
    }
    return {
      content: job.artifactCsv,
      contentType: 'text/csv; charset=utf-8',
      filename: job.filename ?? `${job.reportType}-scheduled.csv`,
    };
  }

  /** Manual run — creates a job and executes immediately. */
  public async runNow(tenantId: string, scheduleId: string) {
    const schedule = await this.deps.schedules.getSchedule(tenantId, scheduleId);
    if (!schedule) throw new ReportScheduleInputError('Schedule not found', 'NOT_FOUND');
    const job = await this.executeSchedule(schedule);
    // Keep cadence clock honest after a manual run.
    await this.deps.schedules.updateSchedule(tenantId, scheduleId, {
      lastRunAt: new Date(),
      nextRunAt: computeNextRunAt(schedule.cadence),
    });
    return toApiJob(job);
  }

  /** Worker entry — claim due rows and execute each. */
  public async processDue(batchSize: number): Promise<number> {
    const due = await this.deps.schedules.claimDueSchedules(batchSize);
    for (const schedule of due) {
      try {
        await this.executeSchedule(schedule);
      } catch (err) {
        this.logger.error(`Scheduled report ${schedule.id} failed: ${(err as Error).message}`);
      }
    }
    return due.length;
  }

  /**
   * Email the report file to the schedule's recipients. A mail failure never fails the
   * job — the artifact stays downloadable and the outcome is recorded on the job.
   */
  private async emailResult(
    schedule: ReportSchedule,
    jobId: string,
    artifact: ReportArtifact,
  ): Promise<{ status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string }> {
    if (schedule.recipients.length === 0) return { status: 'SKIPPED' };
    let outcome: { status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string };
    if (!(await this.deps.mailer.isEnabled(schedule.tenantId))) {
      outcome = { status: 'SKIPPED', error: 'SMTP is not configured for this tenant' };
    } else {
      try {
        const content = buildReportEmail({
          name: schedule.name,
          reportType: schedule.reportType,
          preset: schedule.preset,
          rows: artifact.rows,
          generatedAt: new Date(),
          timeZone: 'Asia/Tehran',
        });
        await this.deps.mailer.send(schedule.tenantId, {
          to: schedule.recipients,
          ...content,
          filename: artifact.filename,
          content: artifact.bytes ?? artifact.csv ?? '',
          contentType: artifact.bytes ? XLSX_MIME : 'text/csv; charset=utf-8',
        });
        outcome = { status: 'SENT' };
      } catch (err) {
        const message = (err as Error)?.message ?? 'email failed';
        this.logger.warn(`Report email for schedule ${schedule.id} failed: ${message}`);
        outcome = { status: 'FAILED', error: message };
      }
    }
    await this.deps.schedules
      .recordEmailResult(schedule.tenantId, jobId, outcome)
      .catch((err) =>
        this.logger.error(`Could not record email result: ${(err as Error).message}`),
      );
    return outcome;
  }

  /** Scheduled files go to people (opened in Excel), so titles and codes are Persian. */
  private async exportReport(schedule: ReportSchedule): Promise<ReportArtifact> {
    const { reportType, tenantId, routeId, routeIds } = schedule;
    const query = { preset: schedule.preset };
    if (reportType === 'haul-cycles' || reportType === 'haul-shifts') {
      if (!this.deps.operations || !routeId) {
        throw new Error(`${reportType} schedule needs a route`);
      }
      return reportType === 'haul-shifts'
        ? this.deps.operations.haulShiftsWorkbook(
            tenantId,
            routeIds.length > 0 ? routeIds : [routeId],
            query,
            'fa',
          )
        : this.deps.operations.haulCyclesCsv(tenantId, routeId, query, 'fa');
    }
    return this.deps.reports.exportCsv(
      tenantId,
      null, // scheduled jobs skip per-user export rate limit
      reportType,
      query,
      'fa',
    );
  }

  private async executeSchedule(schedule: ReportSchedule): Promise<ReportJob> {
    const startedAt = new Date();
    const job = await this.deps.schedules.insertJob({
      tenantId: schedule.tenantId,
      scheduleId: schedule.id,
      reportType: schedule.reportType,
      status: 'RUNNING',
      startedAt,
    });
    try {
      const result = await this.exportReport(schedule);
      const completed = await this.deps.schedules.completeJob(schedule.tenantId, job.id, {
        status: 'SUCCEEDED',
        filename: result.filename,
        artifactCsv: result.csv,
        artifactBytes: result.bytes,
        rowCount: result.rows,
      });
      const emailed = await this.emailResult(schedule, job.id, result);
      const base = completed ?? {
        ...job,
        status: 'SUCCEEDED' as const,
        filename: result.filename,
        rowCount: result.rows,
      };
      return { ...base, emailStatus: emailed.status, emailError: emailed.error ?? null };
    } catch (err) {
      const message = (err as Error)?.message ?? 'export failed';
      const failed = await this.deps.schedules.completeJob(schedule.tenantId, job.id, {
        status: 'FAILED',
        error: message,
      });
      if (failed) return failed;
      throw err;
    }
  }
}

// Re-export types used by controller DTOs without circular imports.
export type { SchedulableReport, ScheduleCadence, SchedulePreset };

/**
 * Report schedule application service — CRUD + run-now + worker execution.
 */
import { Logger } from '@nestjs/common';
import type { ReportService } from './report.service.js';
import {
  type ReportJob,
  type ReportSchedule,
  type ScheduleCadence,
  type SchedulePreset,
  type SchedulableReport,
  computeNextRunAt,
  isScheduleCadence,
  isSchedulePreset,
  isSchedulableReport,
} from '../domain/report-schedule.js';
import type { ReportScheduleRepository } from '../infrastructure/persistence/report-schedule.repository.js';

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
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  name?: string;
  cadence?: string;
  preset?: string;
  enabled?: boolean;
}

export interface ReportScheduleServiceDeps {
  readonly schedules: ReportScheduleRepository;
  readonly reports: ReportService;
}

function toApiSchedule(s: ReportSchedule) {
  return {
    id: s.id,
    name: s.name,
    reportType: s.reportType,
    cadence: s.cadence,
    preset: s.preset,
    enabled: s.enabled,
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
      throw new ReportScheduleInputError('reportType must be trips | vehicle-utilization | alarms');
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
      enabled: input.enabled !== false,
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
      enabled?: boolean;
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
    if (input.enabled !== undefined) patch.enabled = input.enabled;

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
  ): Promise<{ csv: string; filename: string }> {
    const job = await this.deps.schedules.getJobWithArtifact(tenantId, jobId);
    if (!job) throw new ReportScheduleInputError('Job not found', 'NOT_FOUND');
    if (job.status !== 'SUCCEEDED' || !job.artifactCsv) {
      throw new ReportScheduleInputError('Job has no downloadable artifact');
    }
    return {
      csv: job.artifactCsv,
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
        this.logger.error(
          `Scheduled report ${schedule.id} failed: ${(err as Error).message}`,
        );
      }
    }
    return due.length;
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
      const result = await this.deps.reports.exportCsv(
        schedule.tenantId,
        null, // scheduled jobs skip per-user export rate limit
        schedule.reportType,
        { preset: schedule.preset },
      );
      const completed = await this.deps.schedules.completeJob(schedule.tenantId, job.id, {
        status: 'SUCCEEDED',
        filename: result.filename,
        artifactCsv: result.csv,
        rowCount: result.rows,
      });
      return completed ?? { ...job, status: 'SUCCEEDED', filename: result.filename, rowCount: result.rows };
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

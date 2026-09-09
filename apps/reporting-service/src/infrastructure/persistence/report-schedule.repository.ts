/**
 * Persistence for report_schedules + report_jobs (reporting schema).
 */
import { type Knex, withPlatformContext, withTenantContext } from '@fleetvision/persistence-knex';
import type {
  ReportJob,
  ReportJobStatus,
  ReportSchedule,
  ScheduleCadence,
  SchedulePreset,
  SchedulableReport,
} from '../../domain/report-schedule.js';

interface ScheduleRow {
  id: string;
  tenant_id: string;
  name: string;
  report_type: string;
  cadence: string;
  preset: string;
  enabled: boolean;
  next_run_at: Date | string;
  last_run_at: Date | string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface JobRow {
  id: string;
  tenant_id: string;
  schedule_id: string | null;
  report_type: string;
  status: string;
  filename: string | null;
  artifact_csv: string | null;
  row_count: number | null;
  error: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
}

function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

function asDateOrNull(v: Date | string | null): Date | null {
  return v == null ? null : asDate(v);
}

function mapSchedule(r: ScheduleRow): ReportSchedule {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    reportType: r.report_type as SchedulableReport,
    cadence: r.cadence as ScheduleCadence,
    preset: r.preset as SchedulePreset,
    enabled: r.enabled,
    nextRunAt: asDate(r.next_run_at),
    lastRunAt: asDateOrNull(r.last_run_at),
    createdBy: r.created_by,
    createdAt: asDate(r.created_at),
    updatedAt: asDate(r.updated_at),
  };
}

function mapJob(r: JobRow, includeArtifact = false): ReportJob {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    scheduleId: r.schedule_id,
    reportType: r.report_type as SchedulableReport,
    status: r.status as ReportJobStatus,
    filename: r.filename,
    artifactCsv: includeArtifact ? r.artifact_csv : null,
    rowCount: r.row_count,
    error: r.error,
    startedAt: asDateOrNull(r.started_at),
    finishedAt: asDateOrNull(r.finished_at),
    createdAt: asDate(r.created_at),
  };
}

export class ReportScheduleRepository {
  constructor(private readonly knex: Knex) {}

  public async listSchedules(tenantId: string): Promise<ReportSchedule[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx('reporting.report_schedules')
        .where({ tenant_id: tenantId })
        .orderBy('created_at', 'desc')
        .select<ScheduleRow[]>('*');
      return rows.map(mapSchedule);
    });
  }

  public async getSchedule(tenantId: string, id: string): Promise<ReportSchedule | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx('reporting.report_schedules')
        .where({ tenant_id: tenantId, id })
        .first<ScheduleRow>();
      return row ? mapSchedule(row) : null;
    });
  }

  public async insertSchedule(input: {
    tenantId: string;
    name: string;
    reportType: SchedulableReport;
    cadence: ScheduleCadence;
    preset: SchedulePreset;
    enabled: boolean;
    nextRunAt: Date;
    createdBy: string | null;
  }): Promise<ReportSchedule> {
    return withTenantContext(this.knex, input.tenantId, async (trx) => {
      const inserted = await trx('reporting.report_schedules')
        .insert({
          tenant_id: input.tenantId,
          name: input.name,
          report_type: input.reportType,
          cadence: input.cadence,
          preset: input.preset,
          enabled: input.enabled,
          next_run_at: input.nextRunAt,
          created_by: input.createdBy,
        })
        .returning<ScheduleRow[]>('*');
      const row = inserted[0];
      if (!row) throw new Error('Failed to insert report schedule');
      return mapSchedule(row);
    });
  }

  public async updateSchedule(
    tenantId: string,
    id: string,
    patch: Partial<{
      name: string;
      cadence: ScheduleCadence;
      preset: SchedulePreset;
      enabled: boolean;
      nextRunAt: Date;
      lastRunAt: Date | null;
    }>,
  ): Promise<ReportSchedule | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (patch.name !== undefined) updates.name = patch.name;
      if (patch.cadence !== undefined) updates.cadence = patch.cadence;
      if (patch.preset !== undefined) updates.preset = patch.preset;
      if (patch.enabled !== undefined) updates.enabled = patch.enabled;
      if (patch.nextRunAt !== undefined) updates.next_run_at = patch.nextRunAt;
      if (patch.lastRunAt !== undefined) updates.last_run_at = patch.lastRunAt;
      const [row] = await trx('reporting.report_schedules')
        .where({ tenant_id: tenantId, id })
        .update(updates)
        .returning<ScheduleRow[]>('*');
      return row ? mapSchedule(row) : null;
    });
  }

  public async deleteSchedule(tenantId: string, id: string): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const n = await trx('reporting.report_schedules').where({ tenant_id: tenantId, id }).delete();
      return n > 0;
    });
  }

  /**
   * Claim due schedules across tenants (platform). Advances next_run_at
   * immediately so concurrent workers do not double-run.
   */
  public async claimDueSchedules(
    limit: number,
    now: Date = new Date(),
  ): Promise<ReportSchedule[]> {
    return withPlatformContext(this.knex, async (trx) => {
      const due = await trx('reporting.report_schedules')
        .where({ enabled: true })
        .andWhere('next_run_at', '<=', now)
        .orderBy('next_run_at', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .select<ScheduleRow[]>('*');

      const claimed: ReportSchedule[] = [];
      for (const row of due) {
        const cadence = row.cadence as ScheduleCadence;
        const stepMs = cadence === 'daily' ? DAY_MS : 7 * DAY_MS;
        const next = new Date(now.getTime() + stepMs);
        await trx('reporting.report_schedules').where({ id: row.id }).update({
          next_run_at: next,
          last_run_at: now,
          updated_at: trx.fn.now(),
        });
        claimed.push(mapSchedule({ ...row, next_run_at: next, last_run_at: now }));
      }
      return claimed;
    });
  }

  public async insertJob(input: {
    tenantId: string;
    scheduleId: string | null;
    reportType: SchedulableReport;
    status: ReportJobStatus;
    startedAt?: Date | null;
  }): Promise<ReportJob> {
    return withTenantContext(this.knex, input.tenantId, async (trx) => {
      const inserted = await trx('reporting.report_jobs')
        .insert({
          tenant_id: input.tenantId,
          schedule_id: input.scheduleId,
          report_type: input.reportType,
          status: input.status,
          started_at: input.startedAt ?? null,
        })
        .returning<JobRow[]>('*');
      const row = inserted[0];
      if (!row) throw new Error('Failed to insert report job');
      return mapJob(row);
    });
  }

  public async completeJob(
    tenantId: string,
    jobId: string,
    result:
      | { status: 'SUCCEEDED'; filename: string; artifactCsv: string; rowCount: number }
      | { status: 'FAILED'; error: string },
  ): Promise<ReportJob | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const updates: Record<string, unknown> = {
        status: result.status,
        finished_at: trx.fn.now(),
      };
      if (result.status === 'SUCCEEDED') {
        updates.filename = result.filename;
        updates.artifact_csv = result.artifactCsv;
        updates.row_count = result.rowCount;
        updates.error = null;
      } else {
        updates.error = result.error.slice(0, 2000);
      }
      const [row] = await trx('reporting.report_jobs')
        .where({ tenant_id: tenantId, id: jobId })
        .update(updates)
        .returning<JobRow[]>('*');
      return row ? mapJob(row) : null;
    });
  }

  public async listJobs(
    tenantId: string,
    scheduleId: string,
    limit = 20,
  ): Promise<ReportJob[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx('reporting.report_jobs')
        .where({ tenant_id: tenantId, schedule_id: scheduleId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .select<JobRow[]>(
          'id',
          'tenant_id',
          'schedule_id',
          'report_type',
          'status',
          'filename',
          'row_count',
          'error',
          'started_at',
          'finished_at',
          'created_at',
        );
      // artifact_csv omitted from select — map with null
      return rows.map((r) => mapJob({ ...r, artifact_csv: null }));
    });
  }

  public async getJobWithArtifact(tenantId: string, jobId: string): Promise<ReportJob | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx('reporting.report_jobs')
        .where({ tenant_id: tenantId, id: jobId })
        .first<JobRow>();
      return row ? mapJob(row, true) : null;
    });
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

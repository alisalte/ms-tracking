/**
 * Report schedule domain helpers (Phase 1 / F-05).
 *
 * Fixed-report schedules only — trips | vehicle-utilization | alarms.
 * Delivery is downloadable CSV artifacts (email deferred).
 */

export const SCHEDULABLE_REPORTS = ['trips', 'vehicle-utilization', 'alarms'] as const;
export type SchedulableReport = (typeof SCHEDULABLE_REPORTS)[number];

export const SCHEDULE_CADENCES = ['daily', 'weekly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

export const SCHEDULE_PRESETS = ['today', 'yesterday', '7d', '30d'] as const;
export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number];

export type ReportJobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface ReportSchedule {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly reportType: SchedulableReport;
  readonly cadence: ScheduleCadence;
  readonly preset: SchedulePreset;
  readonly enabled: boolean;
  readonly nextRunAt: Date;
  readonly lastRunAt: Date | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ReportJob {
  readonly id: string;
  readonly tenantId: string;
  readonly scheduleId: string | null;
  readonly reportType: SchedulableReport;
  readonly status: ReportJobStatus;
  readonly filename: string | null;
  readonly artifactCsv: string | null;
  readonly rowCount: number | null;
  readonly error: string | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Advance next_run_at by one cadence step from `from` (defaults to now). */
export function computeNextRunAt(cadence: ScheduleCadence, from: Date = new Date()): Date {
  const step = cadence === 'daily' ? DAY_MS : 7 * DAY_MS;
  return new Date(from.getTime() + step);
}

export function isSchedulableReport(v: string): v is SchedulableReport {
  return (SCHEDULABLE_REPORTS as readonly string[]).includes(v);
}

export function isScheduleCadence(v: string): v is ScheduleCadence {
  return (SCHEDULE_CADENCES as readonly string[]).includes(v);
}

export function isSchedulePreset(v: string): v is SchedulePreset {
  return (SCHEDULE_PRESETS as readonly string[]).includes(v);
}

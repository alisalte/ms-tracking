/**
 * Report schedule domain helpers (Phase 1 / F-05).
 *
 * Fixed-report schedules only — trips | vehicle-utilization | alarms.
 * Delivery is a downloadable CSV artifact, optionally emailed to the schedule's recipients.
 */

import { REPORT_UTC_OFFSET_MINUTES } from './report-window.js';

export const SCHEDULABLE_REPORTS = [
  'trips',
  'vehicle-utilization',
  'alarms',
  'haul-cycles',
] as const;
export type SchedulableReport = (typeof SCHEDULABLE_REPORTS)[number];

export const SCHEDULE_CADENCES = ['daily', 'weekly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

export const SCHEDULE_PRESETS = ['today', 'yesterday', '7d', '30d'] as const;
export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number];

export type ReportJobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type ReportEmailStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export const MAX_SCHEDULE_RECIPIENTS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, lowercase, dedupe; returns null if any address is invalid or the list is too long. */
export function normalizeRecipients(input: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const raw of input) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (email.length > 254 || !EMAIL_RE.test(email)) return null;
    if (!out.includes(email)) out.push(email);
  }
  return out.length > MAX_SCHEDULE_RECIPIENTS ? null : out;
}

export interface ReportSchedule {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly reportType: SchedulableReport;
  readonly cadence: ScheduleCadence;
  readonly preset: SchedulePreset;
  /** Haul route for 'haul-cycles' schedules; null for the other report types. */
  readonly routeId: string | null;
  readonly enabled: boolean;
  readonly recipients: readonly string[];
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
  readonly emailStatus: ReportEmailStatus | null;
  readonly emailError: string | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Scheduled reports run at this local hour (Asia/Tehran, UTC+3:30). */
export const SCHEDULE_RUN_HOUR_LOCAL = 6;

/**
 * Next run at SCHEDULE_RUN_HOUR_LOCAL local time: daily = the next such instant
 * strictly after `from`; weekly = 7 days after the most recent one (a run that
 * fires at 06:00 local reschedules to exactly one week later).
 */
export function computeNextRunAt(cadence: ScheduleCadence, from: Date = new Date()): Date {
  const offMs = REPORT_UTC_OFFSET_MINUTES * 60_000;
  const runMs = SCHEDULE_RUN_HOUR_LOCAL * 3_600_000;
  const localDay = Math.floor((from.getTime() + offMs) / DAY_MS) * DAY_MS;
  let next = localDay + runMs - offMs;
  if (next <= from.getTime()) next += DAY_MS;
  return new Date(cadence === 'daily' ? next : next + 6 * DAY_MS);
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

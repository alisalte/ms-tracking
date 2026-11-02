import { describe, expect, it } from '@jest/globals';
import { ReportScheduleService } from '../application/report-schedule.service.js';
import {
  computeNextRunAt,
  isSchedulableReport,
  isScheduleCadence,
  isSchedulePreset,
  normalizeRecipients,
} from '../domain/report-schedule.js';

describe('report-schedule domain', () => {
  it('schedules daily and weekly next_run_at at 06:00 Tehran (UTC+3:30)', () => {
    const from = new Date('2026-09-09T12:00:00.000Z'); // 15:30 local
    expect(computeNextRunAt('daily', from).toISOString()).toBe('2026-09-10T02:30:00.000Z');
    expect(computeNextRunAt('weekly', from).toISOString()).toBe('2026-09-16T02:30:00.000Z');
  });

  it('before 06:00 local the daily run is still today', () => {
    const from = new Date('2026-09-09T20:45:00.000Z'); // 00:15 local on the 10th
    expect(computeNextRunAt('daily', from).toISOString()).toBe('2026-09-10T02:30:00.000Z');
  });

  it('validates schedulable enums', () => {
    expect(isSchedulableReport('trips')).toBe(true);
    expect(isSchedulableReport('distance')).toBe(false);
    expect(isScheduleCadence('daily')).toBe(true);
    expect(isScheduleCadence('hourly')).toBe(false);
    expect(isSchedulePreset('7d')).toBe(true);
    expect(isSchedulePreset('90d')).toBe(false);
  });
});

describe('normalizeRecipients', () => {
  it('trims, lowercases and dedupes', () => {
    expect(normalizeRecipients([' A@x.com ', 'a@x.com', 'b@y.org'])).toEqual([
      'a@x.com',
      'b@y.org',
    ]);
  });

  it('rejects invalid addresses and oversized lists', () => {
    expect(normalizeRecipients(['not-an-email'])).toBeNull();
    const many = Array.from({ length: 11 }, (_, i) => `u${i}@x.com`);
    expect(normalizeRecipients(many)).toBeNull();
  });
});

describe('ReportScheduleService email delivery', () => {
  const schedule = {
    id: 's1',
    tenantId: 't1',
    name: 'Daily trips',
    reportType: 'trips',
    cadence: 'daily',
    preset: '7d',
    enabled: true,
    recipients: ['a@x.com'],
    nextRunAt: new Date(),
    lastRunAt: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as const;

  function build(opts: { mailerEnabled: boolean; sendFails?: boolean; recipients?: string[] }) {
    const recorded: Array<{ status: string; error?: string }> = [];
    const sent: unknown[] = [];
    const repo = {
      getSchedule: async () => ({
        ...schedule,
        recipients: opts.recipients ?? schedule.recipients,
      }),
      updateSchedule: async () => null,
      insertJob: async () => ({
        id: 'j1',
        tenantId: 't1',
        scheduleId: 's1',
        reportType: 'trips',
        status: 'RUNNING',
        startedAt: new Date(),
        finishedAt: null,
        createdAt: new Date(),
      }),
      completeJob: async () => null,
      recordEmailResult: async (_t: string, _j: string, r: { status: string; error?: string }) => {
        recorded.push(r);
      },
    };
    const reports = { exportCsv: async () => ({ filename: 'trips.csv', csv: 'a,b', rows: 1 }) };
    const mailer = {
      isEnabled: async () => opts.mailerEnabled,
      send: async (_tenantId: string, e: unknown) => {
        if (opts.sendFails) throw new Error('smtp down');
        sent.push(e);
      },
    };
    const service = new ReportScheduleService({
      schedules: repo as never,
      reports: reports as never,
      mailer,
    });
    return { service, recorded, sent };
  }

  it('emails the CSV and records SENT', async () => {
    const { service, recorded, sent } = build({ mailerEnabled: true });
    const job = await service.runNow('t1', 's1');
    expect(sent).toHaveLength(1);
    expect(recorded).toEqual([{ status: 'SENT' }]);
    expect(job.emailStatus).toBe('SENT');
  });

  it('keeps the job SUCCEEDED when email fails', async () => {
    const { service, recorded } = build({ mailerEnabled: true, sendFails: true });
    const job = await service.runNow('t1', 's1');
    expect(job.status).toBe('SUCCEEDED');
    expect(job.emailStatus).toBe('FAILED');
    expect(recorded[0]?.error).toBe('smtp down');
  });

  it('marks SKIPPED when SMTP is not configured', async () => {
    const { service } = build({ mailerEnabled: false });
    expect((await service.runNow('t1', 's1')).emailStatus).toBe('SKIPPED');
  });

  it('does not touch the mailer without recipients', async () => {
    const { service, recorded, sent } = build({ mailerEnabled: true, recipients: [] });
    await service.runNow('t1', 's1');
    expect(sent).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });
});

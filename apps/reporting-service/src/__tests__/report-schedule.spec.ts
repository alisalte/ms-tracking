import { describe, expect, it } from '@jest/globals';
import {
  computeNextRunAt,
  isSchedulableReport,
  isScheduleCadence,
  isSchedulePreset,
} from '../domain/report-schedule.js';

describe('report-schedule domain', () => {
  it('advances daily and weekly next_run_at', () => {
    const from = new Date('2026-09-09T12:00:00.000Z');
    expect(computeNextRunAt('daily', from).toISOString()).toBe('2026-09-10T12:00:00.000Z');
    expect(computeNextRunAt('weekly', from).toISOString()).toBe('2026-09-16T12:00:00.000Z');
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

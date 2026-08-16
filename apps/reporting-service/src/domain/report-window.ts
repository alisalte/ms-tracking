/**
 * Report window parsing (Sprint J §16/§18) — pure + unit-testable.
 *
 * Every report accepts EITHER a preset OR a custom [from, to) range:
 *   - presets: today | yesterday | 7d | 30d, resolved in **UTC** (day
 *     boundaries are UTC midnights — see REPORTING-KPI-DEFINITIONS.md §Timezone).
 *   - custom: ISO timestamps, from < to, duration ≤ maxRangeDays.
 *
 * Providing both is ambiguous → error. Boundaries: start INCLUSIVE, end
 * EXCLUSIVE (no 23:59:59 hacks).
 */

export const REPORT_PRESETS = ['today', 'yesterday', '7d', '30d'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export interface ReportWindow {
  readonly from: Date;
  readonly to: Date;
}

export type ReportWindowError =
  | 'AMBIGUOUS'
  | 'UNKNOWN_PRESET'
  | 'INVALID_ISO'
  | 'REVERSED'
  | 'RANGE_TOO_LARGE';

const DAY_MS = 86_400_000;

/** UTC day start (midnight) of the given instant. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function parseReportWindow(input: {
  preset?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  now?: Date;
  maxRangeDays?: number;
}): { window: ReportWindow; error?: undefined } | { error: ReportWindowError; window?: undefined } {
  const now = input.now ?? new Date();
  const maxRangeDays = input.maxRangeDays ?? 92;
  const maxRangeMs = maxRangeDays * DAY_MS;
  const preset = input.preset?.trim() || undefined;
  const hasFromTo = input.from !== undefined || input.to !== undefined;

  if (preset && hasFromTo) return { error: 'AMBIGUOUS' };

  if (preset) {
    switch (preset) {
      case 'today': {
        const start = utcDayStart(now);
        return { window: { from: start, to: now } };
      }
      case 'yesterday': {
        const todayStart = utcDayStart(now);
        return { window: { from: new Date(todayStart.getTime() - DAY_MS), to: todayStart } };
      }
      case '7d':
      case '30d': {
        const days = preset === '7d' ? 7 : 30;
        const start = utcDayStart(new Date(now.getTime() - days * DAY_MS));
        return { window: { from: start, to: now } };
      }
      default:
        return { error: 'UNKNOWN_PRESET' };
    }
  }

  const fromTime = input.from !== undefined ? new Date(input.from) : undefined;
  const toTime = input.to !== undefined ? new Date(input.to) : undefined;
  if (
    (fromTime !== undefined && Number.isNaN(fromTime.getTime())) ||
    (toTime !== undefined && Number.isNaN(toTime.getTime()))
  ) {
    return { error: 'INVALID_ISO' };
  }
  if (fromTime === undefined || toTime === undefined) {
    return { error: 'INVALID_ISO' }; // custom mode requires BOTH bounds
  }
  if (fromTime.getTime() >= toTime.getTime()) return { error: 'REVERSED' };
  if (toTime.getTime() - fromTime.getTime() > maxRangeMs) return { error: 'RANGE_TOO_LARGE' };
  return { window: { from: fromTime, to: toTime } };
}

export function reportWindowErrorMessage(error: ReportWindowError, maxRangeDays: number): string {
  switch (error) {
    case 'AMBIGUOUS':
      return 'Provide either preset or from/to — not both';
    case 'UNKNOWN_PRESET':
      return `preset must be one of ${REPORT_PRESETS.join('|')}`;
    case 'INVALID_ISO':
      return 'from and to must both be valid ISO timestamps';
    case 'REVERSED':
      return 'from must be before to';
    case 'RANGE_TOO_LARGE':
      return `Report range too large (max ${maxRangeDays} days)`;
  }
}

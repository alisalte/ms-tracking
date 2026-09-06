import type { ReportRange } from '@/api/report.api';

/** Format a duration in seconds as `Xh Ym` / `Ym`. Null → em dash. */
export function formatDurationSec(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const DAY_MS = 86_400_000;

/**
 * Resolve a report range to UTC instants — same UTC-day strategy as
 * reporting-service presets (`today` / `yesterday` start at 00:00 UTC).
 */
export function reportRangeBounds(range: ReportRange, now = new Date()): { from: Date; to: Date } {
  if (range.from && range.to) {
    return { from: new Date(range.from), to: new Date(range.to) };
  }
  const to = now;
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  switch (range.preset) {
    case 'today':
      return { from: new Date(utcMidnight), to };
    case 'yesterday':
      return { from: new Date(utcMidnight - DAY_MS), to: new Date(utcMidnight) };
    case '30d':
      return { from: new Date(to.getTime() - 30 * DAY_MS), to };
    default:
      return { from: new Date(to.getTime() - 7 * DAY_MS), to };
  }
}

/** Inclusive check that `iso` falls inside the resolved report window. */
export function isInReportRange(iso: string, range: ReportRange, now?: Date): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const { from, to } = reportRangeBounds(range, now);
  return t >= from.getTime() && t <= to.getTime();
}

/** Hours with one decimal for report charts / KPIs. */
export function hours1(sec: number): number {
  return Math.round(sec / 360) / 10;
}

/** Shorten a vehicle label for chart axes. */
export function shortLabel(label: string, max = 18): string {
  const s = label.trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

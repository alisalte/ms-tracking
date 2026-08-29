/** Format a duration in seconds as `Xh Ym` / `Ym`. Null → em dash. */
export function formatDurationSec(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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

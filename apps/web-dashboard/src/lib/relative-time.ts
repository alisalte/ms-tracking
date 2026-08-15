/**
 * Relative-time formatting helpers (§19 Last Seen).
 *
 * Locale-aware via i18next keys so Farsi renders correctly. Times come from
 * the backend (device_status.lastSeenAt / position.capturedAt) — never
 * fabricated client-side; callers render the "never" key for null values.
 */
import type { TFunction } from 'i18next';

/** Relative age of an ISO timestamp: now / Xm / Xh / Xd ago. */
export function relativeTime(iso: string, t: TFunction): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t('common.unknown');
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return t('dashboard.relative.justNow');
  const min = Math.round(diffSec / 60);
  if (min < 60) return t('dashboard.relative.minutes', { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('dashboard.relative.hours', { count: hr });
  return t('dashboard.relative.days', { count: Math.round(hr / 24) });
}

/**
 * §19 "Last seen" — relative time from the backend timestamp, or the honest
 * "never" label when the device has no status record.
 */
export function lastSeenLabel(iso: string | null | undefined, t: TFunction): string {
  return iso ? relativeTime(iso, t) : t('map.lastSeen.never');
}

/**
 * Locale-aware date/time formatting.
 *
 * The app language (i18n), not the OS locale, chooses the calendar:
 * Persian UI → Solar Hijri (`fa-IR` + `ca-persian`); otherwise Gregorian.
 */
import { i18n } from '@/i18n';

export function isFaLocale(lang?: string): boolean {
  return (lang ?? i18n.language ?? '').toLowerCase().startsWith('fa');
}

/** BCP 47 locale with an explicit calendar so fa never falls back to Gregorian. */
export function dateTimeLocale(lang?: string): string {
  return isFaLocale(lang) ? 'fa-IR-u-ca-persian' : 'en-GB';
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatWith(
  value: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions,
  lang?: string,
): string {
  const d = toDate(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat(dateTimeLocale(lang), options).format(d);
}

/** Date + time (e.g. ۱۵ شهریور ۱۴۰۵، ۱۲:۳۰). */
export function formatDateTime(
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  lang?: string,
): string {
  return formatWith(
    value,
    {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...options,
    },
    lang,
  );
}

/** Calendar date only. */
export function formatDate(
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  lang?: string,
): string {
  return formatWith(
    value,
    {
      dateStyle: options ? undefined : 'medium',
      ...options,
    },
    lang,
  );
}

/** Time of day. */
export function formatTime(
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  lang?: string,
): string {
  return formatWith(
    value,
    {
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    },
    lang,
  );
}

/** Stable calendar-day key for grouping (follows the active calendar). */
export function calendarDayKey(
  value: Date | string | number | null | undefined,
  lang?: string,
): string {
  const d = toDate(value);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat(dateTimeLocale(lang), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

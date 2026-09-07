/**
 * Locale-aware number formatting.
 *
 * Persian UI uses Eastern Arabic-Indic digits via `fa-IR`; otherwise grouping
 * follows `en-US` so English tests and copy stay stable.
 */
import { i18n } from '@/i18n';

export function numberLocale(lang?: string): string {
  return (lang ?? i18n.language ?? 'en').toLowerCase().startsWith('fa') ? 'fa-IR' : 'en-US';
}

export function formatNumber(
  value: number,
  lang?: string,
  options?: Intl.NumberFormatOptions,
): string {
  return value.toLocaleString(numberLocale(lang), options);
}

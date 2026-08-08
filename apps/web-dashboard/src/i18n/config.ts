/**
 * i18n configuration constants.
 *
 * Source: UI_UX_Design.md §0.9
 * - react-i18next
 * - RTL support (Farsi/Hebrew)
 * - Locale-aware formatting
 */

/** Supported language codes. */
export const SUPPORTED_LANGUAGES = ['en', 'fa'] as const;

/** Default fallback language. */
export const FALLBACK_LANGUAGE = 'en';

/** Translation namespaces. */
export const NAMESPACES = ['common'] as const;

/** Default namespace. */
export const DEFAULT_NAMESPACE = 'common';

/** Languages that use right-to-left layout. */
export const RTL_LANGUAGES = ['fa', 'he', 'ar'] as const;

/**
 * Check if a language code requires RTL layout.
 */
export function isRTL(language: string): boolean {
  return (RTL_LANGUAGES as readonly string[]).includes(language);
}

/**
 * Full language display names for language switcher UI.
 */
export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  fa: 'فارسی',
};

import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_NAMESPACE, FALLBACK_LANGUAGE, NAMESPACES, SUPPORTED_LANGUAGES } from './config';

// Import bundled translation resources
import enCommon from './locales/en/common.json';
import faCommon from './locales/fa/common.json';

/** Pre-loaded translation resources. */
const resources = {
  en: { common: enCommon },
  fa: { common: faCommon },
};

/**
 * Initialize i18next with react-i18next plugin.
 *
 * - Uses browser language detection
 * - Falls back to English
 * - Loads bundled JSON translations (no lazy loading in Sprint FE-1)
 * - Supports namespace-based translation splitting
 */
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: FALLBACK_LANGUAGE,
    defaultNS: DEFAULT_NAMESPACE,
    ns: NAMESPACES,
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'fleetvision_language',
    },
  });

export { i18n };

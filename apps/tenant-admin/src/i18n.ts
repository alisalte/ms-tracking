import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import fa from './locales/fa.json';

const stored = typeof window !== 'undefined' ? window.localStorage.getItem('ta_lang') : null;
const lng = stored === 'en' || stored === 'fa' ? stored : 'fa';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fa: { translation: fa } },
  lng,
  fallbackLng: 'fa',
  interpolation: { escapeValue: false },
});

export { i18n };

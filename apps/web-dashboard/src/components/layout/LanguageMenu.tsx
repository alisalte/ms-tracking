import { Check, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Dropdown, DropdownItem } from '@/components/tailwind-ui';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '@/i18n/config';

/**
 * LanguageMenu — Tailwind replacement for the MUI LanguageSwitcher.
 *
 * Calls `i18n.changeLanguage`, which updates all `t()` consumers, re-runs the
 * ThemeRegistry direction effect (flips `<html dir>` + MUI direction), and is
 * persisted by i18next-browser-languagedetector.
 */
export function LanguageMenu() {
  const { i18n } = useTranslation();

  return (
    <Dropdown
      aria-label="select language"
      label={
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <Globe size={17} className="shrink-0 opacity-70" />
          {LANGUAGE_LABELS[i18n.language] ?? i18n.language}
        </span>
      }
    >
      {SUPPORTED_LANGUAGES.map((language) => (
        <DropdownItem
          key={language}
          trailing={i18n.language === language ? <Check size={15} /> : null}
          onClick={() => void i18n.changeLanguage(language)}
        >
          {LANGUAGE_LABELS[language] ?? language}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

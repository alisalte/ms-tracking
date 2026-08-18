import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Dropdown, DropdownItem } from '@/components/tailwind-ui';
import { useThemeContext } from '@/theme/ThemeRegistry';

/**
 * ThemeSwitcher — light / dark / system picker for the TailAdmin header.
 *
 * Selection is persisted by ThemeRegistry (`fleetvision_theme_mode`) and, in
 * `system` mode, follows the OS color scheme live. Replaces the old two-state
 * toggle with the full three-state TailAdmin control.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { preference, setPreference } = useThemeContext();

  const options = [
    { value: 'light', label: t('common.lightMode'), icon: <Sun size={16} /> },
    { value: 'dark', label: t('common.darkMode'), icon: <Moon size={16} /> },
    { value: 'system', label: t('common.systemMode'), icon: <Monitor size={16} /> },
  ] as const;

  const current = options.find((o) => o.value === preference) ?? options[0];

  return (
    <Dropdown
      aria-label={t('common.theme')}
      trigger={<span className="[&_svg]:size-5">{current.icon}</span>}
      triggerClassName="inline-flex size-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-graydark-600 dark:hover:bg-white/5 dark:hover:text-white"
    >
      <DropdownItem header>{t('common.theme')}</DropdownItem>
      {options.map((option) => (
        <DropdownItem
          key={option.value}
          icon={option.icon}
          trailing={preference === option.value ? <Check size={15} /> : null}
          onClick={() => setPreference(option.value)}
        >
          {option.label}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

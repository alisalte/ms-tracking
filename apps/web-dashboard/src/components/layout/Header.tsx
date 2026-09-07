import { HelpCircle, Menu as MenuIcon, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { NotificationBell } from '@/components/shell/NotificationBell';
import { IconButton } from '@/components/tailwind-ui';
import { AppsMenu } from './AppsMenu';
import { Breadcrumb } from './Breadcrumb';
import { LanguageMenu } from './LanguageMenu';
import { ThemeSwitcher } from './ThemeSwitcher';
import { UserMenu } from './UserMenu';

interface HeaderProps {
  /** Hamburger opens the mobile off-canvas sidebar. */
  onMobileMenu: () => void;
}

/**
 * Header — the TailAdmin top bar (Tailwind, 64px sticky).
 *
 * Composition (TailAdmin header pattern): mobile hamburger + breadcrumb on the
 * start side; global search, notification bell (Sprint H — still MUI, reused
 * as-is during the gradual migration), help, theme switcher (light/dark/
 * system), language menu, and user dropdown on the end side.
 *
 * E2E contract: this is a `<header>` element and the notification control must
 * remain reachable as a button named "notifications" inside it.
 */
export function Header({ onMobileMenu }: HeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-gray-200/80 bg-white/92 ps-2.5 pe-4 shadow-sm shadow-gray-900/[0.03] backdrop-blur-xl dark:border-white/8 dark:bg-graydark-200/90 dark:shadow-black/15">
      {/* Mobile hamburger */}
      <IconButton
        variant="ghost"
        aria-label={t('common.openMenu')}
        onClick={onMobileMenu}
        className="lg:hidden"
      >
        <MenuIcon size={20} />
      </IconButton>

      {/* Breadcrumb trail (derived from the nav model) */}
      <Breadcrumb />

      <div className="min-w-0 flex-1" />

      {/* Global search — planned; inert today, parity with the previous topbar */}
      <div className="hidden h-10 max-w-md w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 transition-colors focus-within:border-brand-500 focus-within:bg-white md:flex dark:border-white/15 dark:bg-white/6 dark:focus-within:border-brand-500 dark:focus-within:bg-graydark-300/90">
        <Search size={16} className="shrink-0 text-gray-400 dark:text-graydark-600" aria-hidden />
        <input
          type="search"
          aria-label="global search"
          placeholder={t('common.searchFleet')}
          disabled
          className="h-full w-full min-w-0 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none dark:text-graydark-800 dark:placeholder:text-graydark-600"
        />
      </div>

      {/* End-side controls */}
      <div className="flex shrink-0 items-center gap-0.5">
        <NotificationBell />

        <IconButton variant="ghost" aria-label={t('common.help')} className="hidden sm:inline-flex">
          <HelpCircle size={19} />
        </IconButton>

        <ThemeSwitcher />
        <AppsMenu />
        <LanguageMenu />
        <UserMenu />
      </div>
    </header>
  );
}

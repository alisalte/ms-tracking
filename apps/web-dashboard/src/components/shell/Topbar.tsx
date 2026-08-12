import { HelpCircle, LogOut, Menu as MenuIcon, Moon, Search, Sun, UserCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { Avatar } from '@/components/tailwind-ui';
import { IconButton } from '@/components/tailwind-ui';
import { Tooltip } from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';
import { useThemeContext } from '@/theme/ThemeRegistry';

interface TopbarProps {
  /** Hamburger toggles the mobile sidebar. */
  onMobileMenu: () => void;
}

/**
 * Topbar — the TailAdmin sticky application header (~64px).
 *
 * Light in light mode, layered graydark in dark mode. Contains: mobile
 * hamburger + global pill search (start cluster), notifications bell, help,
 * theme toggle, language switcher, user dropdown (end cluster). The brand logo
 * lives in the sidebar per TailAdmin convention.
 *
 * Behavior preserved from the MUI topbar: theme toggle via `useThemeContext`,
 * logout via `useAuth().logout()` then navigate `/login`, profile link to
 * `/account/profile`. The `NotificationBell` and `LanguageSwitcher` remain the
 * existing MUI-backed components (they own real-time + i18n wiring).
 */
export function Topbar({ onMobileMenu }: TopbarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { mode, toggleColorMode } = useThemeContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the user menu on outside click / Escape (accessible, no portal dep).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-4 dark:border-white/5 dark:bg-graydark-200">
      {/* Mobile hamburger */}
      <IconButton onClick={onMobileMenu} aria-label={t('common.openMenu')} className="lg:!hidden">
        <MenuIcon size={20} />
      </IconButton>

      {/* Global pill search — PLANNED (no backend yet): disabled + honest label. */}
      <div className="flex h-9 max-w-md flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 opacity-70 dark:border-white/10 dark:bg-white/5">
        <Search size={16} className="shrink-0 text-gray-400" />
        <input
          type="search"
          disabled
          placeholder={t('common.searchPlanned')}
          aria-label={t('common.searchPlanned')}
          className="min-w-0 flex-1 cursor-not-allowed bg-transparent text-sm text-gray-500 placeholder:text-gray-400 focus:outline-none dark:text-graydark-500 dark:placeholder:text-graydark-500"
        />
      </div>

      <div className="flex-1" />

      {/* End cluster */}
      <div className="flex items-center gap-1">
        <NotificationBell />

        <Tooltip label={t('common.help')} side="bottom">
          <IconButton aria-label={t('common.help')}>
            <HelpCircle size={19} />
          </IconButton>
        </Tooltip>

        <Tooltip
          label={mode === 'light' ? t('common.darkMode') : t('common.lightMode')}
          side="bottom"
        >
          <IconButton
            onClick={toggleColorMode}
            aria-label={mode === 'light' ? t('common.darkMode') : t('common.lightMode')}
          >
            {mode === 'light' ? <Moon size={19} /> : <Sun size={19} />}
          </IconButton>
        </Tooltip>

        <LanguageSwitcher />

        {/* User menu */}
        <div className="relative ps-1" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            aria-label="user menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center rounded-full transition-opacity hover:opacity-90 fv-focus-ring"
          >
            <Avatar name={user?.email ?? 'User'} size="sm" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute end-0 mt-1 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-white/10 dark:bg-graydark-300"
              style={{ animation: 'fv-fade-in 0.12s ease' }}
            >
              {user && (
                <div className="border-b border-gray-100 px-4 py-3 dark:border-white/5">
                  <div className="truncate text-sm font-semibold text-gray-800 dark:text-white">
                    {user.email || '—'}
                  </div>
                  {user.tenantId && (
                    <div className="truncate text-xs text-gray-500 dark:text-graydark-600">
                      {user.tenantId}
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/account/profile');
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-graydark-700 dark:hover:bg-white/5"
              >
                <UserCircle size={17} />
                {t('common.profile')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-danger-600 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-500/10"
              >
                <LogOut size={17} />
                {t('common.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

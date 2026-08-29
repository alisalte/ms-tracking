import { LogOut, UserCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { getTenantName } from '@/auth/token.storage';
import { Dropdown, DropdownItem } from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';
import { displayLabel } from '@/lib/ids';

/**
 * UserMenu — account dropdown in the TailAdmin header.
 *
 * Shows the signed-in identity (email + tenant), links to the profile page,
 * and signs out (auth-store `logout()` then `/login`), preserving the previous
 * MUI topbar behavior exactly.
 */
export function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const tenantLabel = displayLabel(user?.tenantId, user?.tenantName ?? getTenantName());

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Dropdown
      trigger={
        <span
          aria-hidden
          className="inline-flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-semibold text-white shadow-sm"
        >
          {user?.email?.charAt(0).toUpperCase() ?? 'U'}
        </span>
      }
      triggerClassName="inline-flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      aria-label="user menu"
    >
      {user && (
        <div className="border-b border-gray-100 px-3 py-2.5 dark:border-white/5">
          <p className="truncate text-sm font-semibold text-gray-800 dark:text-white">
            {user.email || '—'}
          </p>
          {tenantLabel && (
            <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-graydark-600">
              <span className="font-medium">{t('auth.tenantId')}: </span>
              {tenantLabel}
            </p>
          )}
        </div>
      )}
      <div className="pt-1">
        <DropdownItem
          icon={<UserCircle />}
          onClick={() => {
            navigate('/account/profile');
          }}
        >
          {t('common.profile')}
        </DropdownItem>
        <DropdownItem icon={<LogOut />} danger onClick={() => void handleLogout()}>
          {t('common.logout')}
        </DropdownItem>
      </div>
    </Dropdown>
  );
}

import { LogOut, UserCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { getTenantName } from '@/auth/token.storage';
import { Avatar, Dropdown, DropdownItem } from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';
import { useProfileMedia } from '@/hooks/useProfileMedia';
import { headingFromEmail, primaryRoleLabel } from '@/lib/display-name';
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
  const media = useProfileMedia(user?.id);
  const tenantLabel = displayLabel(user?.tenantId, user?.tenantName ?? getTenantName());
  const displayName = headingFromEmail(user?.email || 'U');
  const roleLabel = primaryRoleLabel(user?.roles, t('common.profile'), t);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Dropdown
      trigger={
        <span className="flex items-center gap-2.5">
          <Avatar
            name={displayName}
            src={media.avatarUrl ?? undefined}
            size="md"
            className="shadow-sm ring-2 ring-white dark:ring-graydark-200"
          />
          <span className="hidden min-w-0 text-start lg:flex lg:flex-col">
            <span className="max-w-36 truncate text-sm font-semibold text-gray-800 dark:text-white">
              {displayName}
            </span>
            <span className="max-w-36 truncate text-[11px] capitalize text-gray-500 dark:text-graydark-600">
              {roleLabel}
            </span>
          </span>
        </span>
      }
      triggerClassName="inline-flex items-center justify-center rounded-xl px-1.5 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 hover:bg-gray-50 dark:hover:bg-white/5"
      aria-label="user menu"
    >
      {user && (
        <div className="flex items-center gap-3 border-b border-gray-100 px-3 py-3 dark:border-white/5">
          <Avatar
            name={displayName}
            src={media.avatarUrl ?? undefined}
            size="lg"
            className="ring-2 ring-brand-100 dark:ring-brand-500/30"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-800 dark:text-white">
              {displayName}
            </p>
            <p className="truncate text-xs text-gray-500 dark:text-graydark-600" dir="ltr">
              {user.email || '—'}
            </p>
            {tenantLabel && (
              <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-graydark-600">
                {tenantLabel}
              </p>
            )}
          </div>
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

/**
 * UserDetailDrawer — right slide-over showing a user's profile + role bindings
 * (IAM §5.1). Selection → detail pattern (UI_UX §0.6). Read-only: status and
 * role changes are made in tenant management.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserDetail } from '@/api/admin.api';
import { userStatusColor } from '@/components/admin/admin-meta';
import { Badge, Drawer, Spinner } from '@/components/tailwind-ui';
import { userRoleLabel } from '@/lib/admin-labels';
import { formatDate, formatDateTime } from '@/lib/format-date';
import type { Role } from '@/types/admin.types';

interface UserDetailDrawerProps {
  userId: string | null;
  roles: Role[];
  onClose: () => void;
}

export function UserDetailDrawer({ userId, roles, onClose }: UserDetailDrawerProps) {
  const { t } = useTranslation();
  const { data: user, isLoading } = useUserDetail(userId);

  return (
    <Drawer
      open={Boolean(userId)}
      onClose={onClose}
      title={user ? `${user.firstName} ${user.lastName}` : ''}
      subtitle={user?.email}
      size="sm"
    >
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner size="lg" />
        </div>
      ) : user ? (
        <div className="flex flex-col gap-3">
          <Badge color={userStatusColor(user.status)} dot>
            {t(`admin.users.status.${user.status}`)}
          </Badge>

          {/* Profile meta */}
          <div>
            <MetaRow label={t('admin.users.username')} value={user.username} />
            <MetaRow
              label={t('admin.users.role')}
              value={userRoleLabel(t, user.roleIds, roles, user.roleName)}
            />
            <MetaRow
              label={t('admin.users.authProvider')}
              value={t(`admin.users.provider.${user.authProvider}`)}
            />
            <MetaRow
              label={t('admin.users.mfa')}
              value={user.mfaEnabled ? t('admin.users.mfaOn') : t('admin.users.mfaOff')}
            />
            {user.lastLoginAt && (
              <MetaRow
                label={t('admin.users.colLastLogin')}
                value={formatDateTime(user.lastLoginAt)}
              />
            )}
            <MetaRow label={t('admin.users.created')} value={formatDate(user.createdAt)} />
          </div>
        </div>
      ) : (
        <p className="py-6 text-sm text-gray-500 dark:text-graydark-600">
          {t('admin.users.notFound')}
        </p>
      )}
    </Drawer>
  );
}

/** A labeled meta row. */
function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-28 shrink-0 text-sm text-gray-500 dark:text-graydark-600">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-graydark-800">
        {value}
      </span>
    </div>
  );
}

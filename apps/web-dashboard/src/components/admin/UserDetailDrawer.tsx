/**
 * UserDetailDrawer — right slide-over showing a user's profile + role bindings
 * + status actions (IAM §5.1). Selection → detail pattern (UI_UX §0.6).
 * Status changes confirm first (deactivate is destructive/irreversible) and
 * toast on success/failure — never silent mutations.
 */
import { ShieldCheck, UserCog, UserX } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserDetail, useUserStatusAction } from '@/api/admin.api';
import { userStatusColor } from '@/components/admin/admin-meta';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button, Drawer, Spinner } from '@/components/tailwind-ui';
import type { AdminUserStatus } from '@/types/admin.types';

interface UserDetailDrawerProps {
  userId: string | null;
  onClose: () => void;
}

export function UserDetailDrawer({ userId, onClose }: UserDetailDrawerProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: user, isLoading } = useUserDetail(userId);
  const action = useUserStatusAction();

  // Pending confirmation: which status change is awaiting the dialog.
  const [confirmStatus, setConfirmStatus] = useState<AdminUserStatus | null>(null);

  const runStatusChange = (status: AdminUserStatus) => {
    if (!user) return;
    action.mutate(
      { id: user.id, status },
      {
        onSuccess: () => toast.success(`admin.users.toastStatus.${status}`),
        onError: (err) => toast.error(err),
      },
    );
  };

  const confirmCopy =
    confirmStatus === 'deactivated'
      ? {
          title: t('admin.users.confirmDeactivateTitle'),
          message: t('admin.users.confirmDeactivateMessage', { name: user?.firstName ?? '' }),
          confirmLabelKey: 'admin.users.deactivate',
        }
      : confirmStatus === 'suspended'
        ? {
            title: t('admin.users.confirmSuspendTitle'),
            message: t('admin.users.confirmSuspendMessage', { name: user?.firstName ?? '' }),
            confirmLabelKey: 'admin.users.suspend',
          }
        : confirmStatus === 'active'
          ? {
              title: t('admin.users.confirmActivateTitle'),
              message: t('admin.users.confirmActivateMessage', { name: user?.firstName ?? '' }),
              confirmLabelKey: 'admin.users.activate',
            }
          : null;

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
            <MetaRow label={t('admin.users.role')} value={user.roleName} />
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
                value={new Date(user.lastLoginAt).toLocaleString()}
              />
            )}
            <MetaRow
              label={t('admin.users.created')}
              value={new Date(user.createdAt).toLocaleDateString()}
            />
          </div>

          <hr className="my-2 border-gray-100 dark:border-white/5" />

          {/* Status actions (IAM §5.1 PATCH /users/{id}/status) — confirmed + toasted. */}
          <section>
            <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
              {t('admin.users.actions')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {user.status === 'active' && (
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<UserX size={14} />}
                  disabled={action.isPending}
                  className="border-warning-500 text-warning-600 hover:bg-warning-50 dark:border-warning-400 dark:text-warning-400 dark:hover:bg-warning-500/10"
                  onClick={() => setConfirmStatus('suspended')}
                >
                  {t('admin.users.suspend')}
                </Button>
              )}
              {(user.status === 'suspended' || user.status === 'locked') && (
                <Button
                  size="sm"
                  variant="success"
                  leftIcon={<ShieldCheck size={14} />}
                  disabled={action.isPending}
                  onClick={() => setConfirmStatus('active')}
                >
                  {t('admin.users.activate')}
                </Button>
              )}
              {user.status !== 'deactivated' && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<UserCog size={14} />}
                  disabled={action.isPending}
                  className="text-danger-600 hover:bg-danger-50 hover:text-danger-700 dark:text-danger-400 dark:hover:bg-danger-500/10"
                  onClick={() => setConfirmStatus('deactivated')}
                >
                  {t('admin.users.deactivate')}
                </Button>
              )}
            </div>
          </section>
        </div>
      ) : (
        <p className="py-6 text-sm text-gray-500 dark:text-graydark-600">
          {t('admin.users.notFound')}
        </p>
      )}

      {confirmCopy && confirmStatus && (
        <ConfirmDialog
          open
          title={confirmCopy.title}
          message={confirmCopy.message}
          confirmLabelKey={confirmCopy.confirmLabelKey}
          tone={confirmStatus === 'deactivated' ? 'danger' : 'default'}
          loading={action.isPending}
          onClose={() => setConfirmStatus(null)}
          onConfirm={() => {
            runStatusChange(confirmStatus);
            setConfirmStatus(null);
          }}
        />
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

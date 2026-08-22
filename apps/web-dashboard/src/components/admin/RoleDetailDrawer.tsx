/**
 * RoleDetailDrawer — right slide-over showing a role's permission matrix
 * grouped by domain (02_Domain_Model §6.1 catalog). Each domain's permissions
 * render as a checklist reflecting whether the role grants them.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Checkbox, Drawer, Spinner } from '@/components/tailwind-ui';
import { PERMISSION_CATALOG } from '@/mock/admin-data';
import type { Role } from '@/types/admin.types';

interface RoleDetailDrawerProps {
  role: Role | null;
  loading?: boolean;
  onClose: () => void;
}

export function RoleDetailDrawer({ role, loading = false, onClose }: RoleDetailDrawerProps) {
  const { t } = useTranslation();
  const open = Boolean(role);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={role?.name ?? ''}
      subtitle={role?.description}
      size="md"
    >
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner size="lg" />
        </div>
      ) : role ? (
        <div className="flex flex-col gap-3">
          {role.mfaRequired && (
            <div className="mb-1">
              <Badge color="danger">MFA</Badge>
            </div>
          )}

          <div>
            <MetaRow
              label={t('admin.roles.type')}
              value={role.isSystem ? t('admin.roles.system') : t('admin.roles.custom')}
            />
            <MetaRow
              label={t('admin.roles.permissions')}
              value={String(role.permissionKeys.length)}
            />
            <MetaRow label={t('admin.roles.members')} value={String(role.memberCount)} />
          </div>

          <hr className="my-2 border-gray-100 dark:border-white/5" />

          {/* Permission matrix by domain (§6.1) */}
          <section>
            <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
              {t('admin.roles.permissionMatrix')}
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {PERMISSION_CATALOG.map((group) => {
                const grantedInDomain = group.permissions.filter((p) =>
                  role.permissionKeys.includes(p),
                );
                const allGranted = grantedInDomain.length === group.permissions.length;
                return (
                  <div
                    key={group.domain}
                    className="rounded-lg border border-gray-200 p-2 dark:border-white/10"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-800 dark:text-graydark-800">
                        {t(group.labelKey)}
                      </span>
                      <Badge color={allGranted ? 'success' : 'gray'}>
                        {grantedInDomain.length}/{group.permissions.length}
                      </Badge>
                    </div>
                    <div className="mt-1 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                      {group.permissions.map((p) => (
                        <Checkbox
                          key={p}
                          checked={role.permissionKeys.includes(p)}
                          // Read-only in this sprint (role edit is a follow-up).
                          readOnly
                          label={<span className="font-mono text-[0.65rem]">{p}</span>}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
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

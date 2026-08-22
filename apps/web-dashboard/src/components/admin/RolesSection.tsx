/**
 * RolesSection — the roles registry (UI_UX §5.3 bottom "Roles (custom)" + the
 * system roles from 02_Domain_Model §6.2).
 *
 * Lists system + custom roles with permission counts + member counts. Click a
 * role to open the RoleDetailDrawer showing its permission matrix grouped by
 * domain (§6.1 catalog).
 */
import { useTranslation } from 'react-i18next';

import { Badge, Card, Skeleton } from '@/components/tailwind-ui';
import type { Role } from '@/types/admin.types';

interface RolesSectionProps {
  roles: Role[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

export function RolesSection({ roles, loading = false, selectedId, onSelect }: RolesSectionProps) {
  const { t } = useTranslation();
  const system = roles.filter((r) => r.isSystem);
  const custom = roles.filter((r) => !r.isSystem);

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-2">
        {['rsk-a', 'rsk-b', 'rsk-c'].map((k) => (
          <Skeleton key={k} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-2">
      {/* Custom roles (UI_UX §5.3) */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white">
          {t('admin.roles.custom')}
        </h2>
        <RoleGrid roles={custom} selectedId={selectedId} onSelect={onSelect} t={t} />
      </section>

      {/* System roles (§6.2) */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white">
          {t('admin.roles.system')}
        </h2>
        <RoleGrid roles={system} selectedId={selectedId} onSelect={onSelect} t={t} />
      </section>
    </div>
  );
}

/** A responsive grid of role cards. */
function RoleGrid({
  roles,
  selectedId,
  onSelect,
  t,
}: {
  roles: Role[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
      {roles.map((r) => (
        <Card
          key={r.id}
          as="button"
          type="button"
          onClick={() => onSelect(r.id)}
          className={`text-start transition-colors ${
            r.id === selectedId
              ? 'border-2 border-brand-500 ring-2 ring-brand-500/20'
              : 'hover:border-gray-300 dark:hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-gray-800 dark:text-white">
              {r.name}
            </span>
            {r.mfaRequired && <Badge color="danger">MFA</Badge>}
          </div>
          <p className="mt-1 min-h-9 text-sm text-gray-500 dark:text-graydark-600">
            {r.description}
          </p>
          <div className="mt-2 flex gap-6">
            <div>
              <p className="text-xs text-gray-500 dark:text-graydark-600">
                {t('admin.roles.permissions')}
              </p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {r.permissionKeys.length}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-graydark-600">
                {t('admin.roles.members')}
              </p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{r.memberCount}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

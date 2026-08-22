/**
 * PermissionsSection — the full canonical permission catalog rendered by domain
 * (02_Domain_Model §6.1). A read-only reference of every permission the
 * platform defines, grouped by the 14 bounded-context domains.
 */
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/tailwind-ui';
import type { PermissionGroup } from '@/types/admin.types';

interface PermissionsSectionProps {
  catalog: PermissionGroup[];
}

export function PermissionsSection({ catalog }: PermissionsSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 p-2">
      <p className="text-sm text-gray-500 dark:text-graydark-600">
        {t('admin.permissions.subtitle')}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {catalog.map((group) => (
          <div
            key={group.domain}
            className="rounded-xl border border-gray-200 p-4 dark:border-white/10"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
                {t(group.labelKey)}
              </h3>
              <Badge color="gray">{group.permissions.length}</Badge>
            </div>
            <div className="flex flex-col gap-0.5">
              {group.permissions.map((p) => (
                <span
                  key={p}
                  className="font-mono text-[0.68rem] text-gray-500 dark:text-graydark-600"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

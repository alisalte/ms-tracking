/**
 * PermissionsSection — the full canonical permission catalog rendered by domain
 * (02_Domain_Model §6.1). A read-only reference of every permission the
 * platform defines, grouped by the 14 bounded-context domains. Renders a
 * skeleton grid while the catalog loads (never a blank "empty" first paint).
 */
import { useTranslation } from 'react-i18next';

import { Badge, Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import type { PermissionGroup } from '@/types/admin.types';

interface PermissionsSectionProps {
  catalog: PermissionGroup[];
  loading?: boolean;
}

export function PermissionsSection({ catalog, loading = false }: PermissionsSectionProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy>
        {['pc-a', 'pc-b', 'pc-c', 'pc-d'].map((k) => (
          <Skeleton key={k} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500 dark:text-graydark-600">
        {t('admin.permissions.subtitle')}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {catalog.map((group) => (
          <Card key={group.domain} flush className="p-4">
            <CardHeader
              title={t(group.labelKey)}
              action={<Badge color="gray">{group.permissions.length}</Badge>}
              className="mb-3"
            />
            <div className="flex flex-col gap-0.5">
              {group.permissions.map((p) => (
                <span key={p} className="font-mono text-xs text-gray-500 dark:text-graydark-600">
                  {p}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * OrganizationSection — tenant identity (GET /tenant) plus live counts from
 * the IAM + fleet registries. Divisions/org-tree are not modeled yet; the
 * tenant row is the org.
 */
import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTenant, useUsers } from '@/api/admin.api';
import { useFleets, useVehicles } from '@/api/asset.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge, Card, CardHeader, Skeleton } from '@/components/tailwind-ui';

export function OrganizationSection() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const users = useUsers();
  const fleets = useFleets();
  const vehicles = useVehicles();

  if (tenant.isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (tenant.error) {
    return <ErrorState error={tenant.error} onRetry={() => void tenant.refetch()} />;
  }
  const org = tenant.data;
  if (!org) {
    return <p className="text-sm text-gray-500 dark:text-graydark-600">{t('admin.org.empty')}</p>;
  }

  const stats = [
    { label: t('admin.org.users'), value: users.data?.length ?? '—' },
    { label: t('admin.org.fleets'), value: fleets.data?.length ?? '—' },
    { label: t('admin.org.vehicles'), value: vehicles.data?.length ?? '—' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={org.name}
          action={
            <Badge color={org.status === 'ACTIVE' ? 'success' : 'warning'} dot>
              {org.status}
            </Badge>
          }
        />
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Meta label={t('admin.org.tier')} value={org.tier} />
          <Meta label={t('admin.org.region')} value={org.region} />
        </dl>
      </Card>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <p className="text-xs text-gray-500 dark:text-graydark-600">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{s.value}</p>
          </Card>
        ))}
      </div>
      <p className="flex items-start gap-2 text-sm text-gray-500 dark:text-graydark-600">
        <Building2 size={16} className="mt-0.5 shrink-0" aria-hidden />
        {t('admin.org.treeNote')}
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-graydark-600">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-800 dark:text-graydark-800">{value}</dd>
    </div>
  );
}

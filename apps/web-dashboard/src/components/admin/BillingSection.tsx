/**
 * BillingSection — live license + quota snapshot from GET /tenant.
 */
import { CreditCard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTenant } from '@/api/admin.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge, Card, CardHeader, EmptyState, Skeleton } from '@/components/tailwind-ui';
import type { TenantQuotaMeter } from '@/types/admin.types';

export function BillingSection() {
  const { t } = useTranslation();
  const tenant = useTenant();

  if (tenant.isLoading) return <Skeleton className="h-40 w-full" />;
  if (tenant.error) {
    return <ErrorState error={tenant.error} onRetry={() => void tenant.refetch()} />;
  }
  const org = tenant.data;
  const license = org?.license;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={t('admin.billing.subscription')}
          action={
            org ? (
              <Badge color={org.status === 'ACTIVE' ? 'success' : 'warning'} dot>
                {org.status}
              </Badge>
            ) : null
          }
        />
        {org ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-500 dark:text-graydark-600">
                {t('admin.billing.tier')}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">
                {license?.planCode ?? org.tier}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 dark:text-graydark-600">
                {t('admin.billing.region')}
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-gray-800 dark:text-graydark-800">
                {org.region}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 dark:text-graydark-600">
                {t('admin.settings.orgName')}
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-gray-800 dark:text-graydark-800">
                {org.name}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-gray-500">{t('admin.org.empty')}</p>
        )}
      </Card>

      {license && (
        <Card>
          <CardHeader
            title={t('admin.billing.license')}
            action={
              <Badge
                color={
                  license.licenseStatus === 'ACTIVE'
                    ? 'success'
                    : license.licenseStatus === 'GRACE'
                      ? 'warning'
                      : 'danger'
                }
                dot
              >
                {license.licenseStatus}
              </Badge>
            }
          />
          <p className="mt-2 font-mono text-sm text-gray-600 dark:text-graydark-700">
            {license.licenseKey}
          </p>
          <p className="mt-1 text-sm text-gray-700 dark:text-graydark-800">
            {license.daysRemaining >= 0
              ? t('admin.billing.daysLeft', { count: license.daysRemaining })
              : t('admin.billing.expired')}
          </p>
          {license.licenseStatus === 'GRACE' && (
            <p className="mt-1 text-sm text-amber-700">{t('admin.billing.grace')}</p>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <QuotaBar label={t('admin.billing.users')} meter={license.quotas.users} />
            <QuotaBar label={t('admin.billing.vehicles')} meter={license.quotas.vehicles} />
            <QuotaBar label={t('admin.billing.devices')} meter={license.quotas.devices} />
            <QuotaBar label={t('admin.billing.drivers')} meter={license.quotas.drivers} />
          </div>
        </Card>
      )}

      <EmptyState
        icon={<CreditCard />}
        title={t('admin.billing.invoicesTitle')}
        description={t('admin.billing.invoicesBody')}
      />
    </div>
  );
}

function QuotaBar({ label, meter }: { label: string; meter: TenantQuotaMeter }) {
  const color =
    meter.state === 'exceeded'
      ? 'bg-danger-500'
      : meter.state === 'warn'
        ? 'bg-warning-500'
        : 'bg-brand-500';
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 dark:text-graydark-600">
        <span>{label}</span>
        <span className="tabular-nums">
          {meter.used}/{meter.limit}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, meter.pct)}%` }} />
      </div>
    </div>
  );
}

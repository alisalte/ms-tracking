/**
 * BillingSection — subscription snapshot from GET /tenant.
 *
 * Invoices, usage meters, and payment methods live in billing-service which
 * is not in the running stack — those cards state that honestly.
 */
import { CreditCard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTenant } from '@/api/admin.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge, Card, CardHeader, EmptyState, Skeleton } from '@/components/tailwind-ui';

export function BillingSection() {
  const { t } = useTranslation();
  const tenant = useTenant();

  if (tenant.isLoading) return <Skeleton className="h-40 w-full" />;
  if (tenant.error) {
    return <ErrorState error={tenant.error} onRetry={() => void tenant.refetch()} />;
  }
  const org = tenant.data;

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
                {org.tier}
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
      <EmptyState
        icon={<CreditCard />}
        title={t('admin.billing.invoicesTitle')}
        description={t('admin.billing.invoicesBody')}
      />
    </div>
  );
}

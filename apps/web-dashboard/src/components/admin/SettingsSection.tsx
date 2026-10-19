/**
 * SettingsSection — read-only view of the organisation settings (UI_UX §5.2
 * Settings): locale, timezone, units, date format, org name and data
 * retention. They are edited in tenant management.
 */
import { useTranslation } from 'react-i18next';

import { useSettings, useTenant } from '@/api/admin.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Alert, Card, CardHeader } from '@/components/tailwind-ui';

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-40 shrink-0 text-sm text-gray-500 dark:text-graydark-600">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-graydark-800">
        {value}
      </span>
    </div>
  );
}

export function SettingsSection() {
  const { t } = useTranslation();
  const { data: settings, isLoading, isError, error, refetch } = useSettings();
  const tenant = useTenant();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 py-10" aria-busy>
        <span className="sr-only">{t('common.loading')}</span>
        <div className="mx-auto h-64 w-full max-w-2xl animate-pulse rounded-2xl bg-gray-100 dark:bg-white/5" />
      </div>
    );
  }

  if (isError || !settings) {
    return (
      <ErrorState
        error={error ?? new Error('Tenant settings are unavailable')}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {tenant.data?.license && (
        <Alert
          variant={
            tenant.data.license.licenseStatus === 'EXPIRED'
              ? 'danger'
              : tenant.data.license.licenseStatus === 'GRACE' ||
                  tenant.data.license.quotas.users.state !== 'ok' ||
                  tenant.data.license.quotas.vehicles.state !== 'ok'
                ? 'warning'
                : 'info'
          }
        >
          {tenant.data.license.daysRemaining >= 0
            ? t('admin.billing.daysLeft', { count: tenant.data.license.daysRemaining })
            : t('admin.billing.expired')}
          {tenant.data.license.licenseStatus === 'GRACE' ? ` — ${t('admin.billing.grace')}` : ''}
        </Alert>
      )}
      <div data-testid="settings-managed-elsewhere">
        <Alert variant="info">{t('admin.settings.managedInTenantAdmin')}</Alert>
      </div>

      <Card>
        <CardHeader title={t('admin.settings.locale')} />
        <Row
          label={t('admin.settings.language')}
          value={t(`admin.settings.lang.${settings.locale}`)}
        />
        <Row label={t('admin.settings.timezone')} value={settings.timezone} />
        <Row label={t('admin.settings.dateFormat')} value={settings.dateFormat} />
      </Card>

      <Card>
        <CardHeader title={t('admin.settings.units')} />
        <Row label={t('admin.settings.distance')} value={settings.distanceUnit} />
        <Row label={t('admin.settings.volume')} value={settings.volumeUnit} />
        <Row label={t('admin.settings.temperature')} value={`°${settings.tempUnit}`} />
      </Card>

      <Card>
        <CardHeader title={t('admin.settings.branding')} />
        <Row label={t('admin.settings.orgName')} value={settings.orgName} />
        <Row label={t('admin.settings.retention')} value={settings.retentionDays} />
      </Card>
    </div>
  );
}

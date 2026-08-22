/**
 * SettingsSection — tenant settings form (UI_UX §5.2 Settings).
 *
 * Locale, timezone, units (distance/volume/temp), date format, org name
 * (branding), and data-retention preview. Saves via `useUpdateSettings`
 * (optimistic).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSettings, useUpdateSettings } from '@/api/admin.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Button, Card, CardHeader, Input, Select, Spinner } from '@/components/tailwind-ui';
import type { DistanceUnit, TempUnit, VolumeUnit } from '@/types/admin.types';

const TIMEZONES = ['UTC', 'Asia/Tehran', 'America/New_York', 'Europe/London', 'Asia/Dubai'];
const LOCALES = ['en', 'fa'];

export function SettingsSection() {
  const { t } = useTranslation();
  const { data: settings, isLoading, isError, error, refetch } = useSettings();
  const update = useUpdateSettings();

  // Local form state mirrors the loaded settings; edit + Save commits.
  const draft = useMemo(() => settings, [settings]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner size="lg" />
      </div>
    );
  }

  // No settings backend exists yet — fail honestly instead of fabricating (§22).
  if (isError || !draft) {
    return (
      <ErrorState
        error={error ?? new Error('Tenant settings are unavailable')}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4 p-2">
      {/* Locale & format */}
      <Card>
        <CardHeader title={t('admin.settings.locale')} />
        <div className="flex flex-col gap-4">
          <Select
            label={t('admin.settings.language')}
            value={draft.locale}
            onChange={(e) => update.mutate({ locale: e.target.value })}
            options={LOCALES.map((l) => ({ value: l, label: t(`admin.settings.lang.${l}`) }))}
          />
          <Select
            label={t('admin.settings.timezone')}
            value={draft.timezone}
            onChange={(e) => update.mutate({ timezone: e.target.value })}
            options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
          />
          <Input
            label={t('admin.settings.dateFormat')}
            value={draft.dateFormat}
            onChange={(e) => update.mutate({ dateFormat: e.target.value })}
          />
        </div>
      </Card>

      {/* Units */}
      <Card>
        <CardHeader title={t('admin.settings.units')} />
        <div className="flex flex-wrap gap-4">
          <Select
            label={t('admin.settings.distance')}
            wrapperClassName="w-32"
            value={draft.distanceUnit}
            onChange={(e) => update.mutate({ distanceUnit: e.target.value as DistanceUnit })}
            options={[
              { value: 'km', label: 'km' },
              { value: 'mi', label: 'mi' },
            ]}
          />
          <Select
            label={t('admin.settings.volume')}
            wrapperClassName="w-32"
            value={draft.volumeUnit}
            onChange={(e) => update.mutate({ volumeUnit: e.target.value as VolumeUnit })}
            options={[
              { value: 'L', label: 'L' },
              { value: 'gal', label: 'gal' },
            ]}
          />
          <Select
            label={t('admin.settings.temperature')}
            wrapperClassName="w-32"
            value={draft.tempUnit}
            onChange={(e) => update.mutate({ tempUnit: e.target.value as TempUnit })}
            options={[
              { value: 'C', label: '°C' },
              { value: 'F', label: '°F' },
            ]}
          />
        </div>
      </Card>

      {/* Branding + retention */}
      <Card>
        <CardHeader title={t('admin.settings.branding')} />
        <div className="flex flex-col gap-4">
          <Input
            label={t('admin.settings.orgName')}
            value={draft.orgName}
            onChange={(e) => update.mutate({ orgName: e.target.value })}
          />
          <Input
            type="number"
            label={t('admin.settings.retention')}
            wrapperClassName="w-40"
            value={draft.retentionDays}
            onChange={(e) => update.mutate({ retentionDays: Number(e.target.value) || 0 })}
            hint={t('admin.settings.retentionDays')}
          />
        </div>
      </Card>

      <div>
        <Button disabled={update.isPending}>
          {update.isPending ? t('admin.settings.saving') : t('admin.settings.saved')}
        </Button>
      </div>
    </div>
  );
}

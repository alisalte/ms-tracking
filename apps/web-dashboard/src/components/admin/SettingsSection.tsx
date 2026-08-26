/**
 * SettingsSection — tenant settings form (UI_UX §5.2 Settings).
 *
 * Locale, timezone, units (distance/volume/temp), date format, org name
 * (branding), and data-retention. Proper form semantics: edits land in a
 * local draft, a REAL Save button commits the dirty diff (one request, not a
 * mutation per keystroke), Reset restores the loaded values, failures render
 * an inline Alert (never a passive "Saved" label), and success toasts.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSettings, useUpdateSettings } from '@/api/admin.api';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, Card, CardHeader, Input, Select } from '@/components/tailwind-ui';
import type { TenantSettings } from '@/types/admin.types';
import type { DistanceUnit, TempUnit, VolumeUnit } from '@/types/admin.types';

const TIMEZONES = ['UTC', 'Asia/Tehran', 'America/New_York', 'Europe/London', 'Asia/Dubai'];
const LOCALES = ['en', 'fa'];

/** The editable subset of TenantSettings (numbers coerced, ids dropped). */
type SettingsDraft = Pick<
  TenantSettings,
  | 'locale'
  | 'timezone'
  | 'dateFormat'
  | 'distanceUnit'
  | 'volumeUnit'
  | 'tempUnit'
  | 'orgName'
  | 'retentionDays'
>;

function toDraft(s: TenantSettings): SettingsDraft {
  return {
    locale: s.locale,
    timezone: s.timezone,
    dateFormat: s.dateFormat,
    distanceUnit: s.distanceUnit,
    volumeUnit: s.volumeUnit,
    tempUnit: s.tempUnit,
    orgName: s.orgName,
    retentionDays: s.retentionDays,
  };
}

export function SettingsSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: settings, isLoading, isError, error, refetch } = useSettings();
  const update = useUpdateSettings();

  // Local form state mirrors the loaded settings; Save commits the dirty diff.
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  useEffect(() => {
    if (settings) setDraft(toDraft(settings));
  }, [settings]);

  const saved = useMemo(() => (settings ? toDraft(settings) : null), [settings]);
  const dirty = useMemo(
    () => Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)),
    [draft, saved],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 py-10" aria-busy>
        <span className="sr-only">{t('common.loading')}</span>
        <div className="mx-auto h-64 w-full max-w-2xl animate-pulse rounded-2xl bg-gray-100 dark:bg-white/5" />
      </div>
    );
  }

  if (isError || !draft || !saved) {
    return (
      <ErrorState
        error={error ?? new Error('Tenant settings are unavailable')}
        onRetry={() => refetch()}
      />
    );
  }

  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = () => {
    if (!dirty) return;
    // Send only the changed keys — one request for the whole form. (Built as
    // a plain record: TS cannot write a union-typed value into a union-indexed
    // Partial.)
    const diff = {} as Record<string, unknown>;
    for (const key of Object.keys(draft) as Array<keyof SettingsDraft>) {
      if (draft[key] !== saved[key]) diff[key] = draft[key];
    }
    update.mutate(diff as Partial<TenantSettings>, {
      onSuccess: () => toast.success('admin.settings.toastSaved'),
      onError: (err) => toast.error(err),
    });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {update.isError && <Alert variant="danger">{t('admin.settings.saveFailed')}</Alert>}

      {/* Locale & format */}
      <Card>
        <CardHeader title={t('admin.settings.locale')} />
        <div className="flex flex-col gap-4">
          <Select
            label={t('admin.settings.language')}
            value={draft.locale}
            onChange={(e) => set('locale', e.target.value)}
            options={LOCALES.map((l) => ({ value: l, label: t(`admin.settings.lang.${l}`) }))}
          />
          <Select
            label={t('admin.settings.timezone')}
            value={draft.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
          />
          <Input
            label={t('admin.settings.dateFormat')}
            value={draft.dateFormat}
            onChange={(e) => set('dateFormat', e.target.value)}
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
            onChange={(e) => set('distanceUnit', e.target.value as DistanceUnit)}
            options={[
              { value: 'km', label: 'km' },
              { value: 'mi', label: 'mi' },
            ]}
          />
          <Select
            label={t('admin.settings.volume')}
            wrapperClassName="w-32"
            value={draft.volumeUnit}
            onChange={(e) => set('volumeUnit', e.target.value as VolumeUnit)}
            options={[
              { value: 'L', label: 'L' },
              { value: 'gal', label: 'gal' },
            ]}
          />
          <Select
            label={t('admin.settings.temperature')}
            wrapperClassName="w-32"
            value={draft.tempUnit}
            onChange={(e) => set('tempUnit', e.target.value as TempUnit)}
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
            onChange={(e) => set('orgName', e.target.value)}
          />
          <Input
            type="number"
            label={t('admin.settings.retention')}
            wrapperClassName="w-40"
            value={draft.retentionDays}
            onChange={(e) => set('retentionDays', Number(e.target.value) || 0)}
            hint={t('admin.settings.retentionDays')}
          />
        </div>
      </Card>

      {/* Real action bar — disabled until the draft actually differs. */}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || update.isPending} loading={update.isPending}>
          {t('admin.settings.save')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setDraft(saved)}
          disabled={!dirty || update.isPending}
        >
          {t('admin.settings.reset')}
        </Button>
        {dirty && !update.isPending && (
          <span className="text-xs text-gray-500 dark:text-graydark-600">
            {t('admin.settings.unsaved')}
          </span>
        )}
      </div>
    </div>
  );
}

import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiMessage } from '@/api/client';
import { type TenantSettings, getTenantSettings, updateTenantSettings } from '@/api/tenants';

const TIMEZONES = ['UTC', 'Asia/Tehran', 'America/New_York', 'Europe/London', 'Asia/Dubai'];
const field = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';

export function TenantSettingsPanel({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<TenantSettings | null>(null);
  const [draft, setDraft] = useState<TenantSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError(null);
    setNotice(null);
    void getTenantSettings(tenantId)
      .then((s) => {
        setSaved(s);
        setDraft(s);
      })
      .catch((err: unknown) => setError(apiMessage(err)));
  }, [tenantId]);

  const dirty = saved && draft ? JSON.stringify(saved) !== JSON.stringify(draft) : false;
  const set = <K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updateTenantSettings(tenantId, draft);
      setSaved(next);
      setDraft(next);
      setNotice(t('settings.saved'));
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-settings-panel">
      <p className="text-sm text-slate-600">{t('settings.hint')}</p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      )}
      {draft && (
        <form
          onSubmit={onSubmit}
          className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            {t('settings.orgName')}
            <input
              className={field}
              value={draft.orgName}
              maxLength={128}
              required
              onChange={(e) => set('orgName', e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('settings.locale')}
            <select
              className={field}
              value={draft.locale}
              onChange={(e) => set('locale', e.target.value as TenantSettings['locale'])}
            >
              <option value="fa">فارسی</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('settings.timezone')}
            <select
              className={field}
              value={draft.timezone}
              onChange={(e) => set('timezone', e.target.value)}
            >
              {(TIMEZONES.includes(draft.timezone)
                ? TIMEZONES
                : [draft.timezone, ...TIMEZONES]
              ).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('settings.dateFormat')}
            <input
              className={field}
              value={draft.dateFormat}
              maxLength={32}
              required
              onChange={(e) => set('dateFormat', e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('settings.distanceUnit')}
            <select
              className={field}
              value={draft.distanceUnit}
              onChange={(e) =>
                set('distanceUnit', e.target.value as TenantSettings['distanceUnit'])
              }
            >
              <option value="km">km</option>
              <option value="mi">mi</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('settings.volumeUnit')}
            <select
              className={field}
              value={draft.volumeUnit}
              onChange={(e) => set('volumeUnit', e.target.value as TenantSettings['volumeUnit'])}
            >
              <option value="L">L</option>
              <option value="gal">gal</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('settings.tempUnit')}
            <select
              className={field}
              value={draft.tempUnit}
              onChange={(e) => set('tempUnit', e.target.value as TenantSettings['tempUnit'])}
            >
              <option value="C">°C</option>
              <option value="F">°F</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('settings.retentionDays')}
            <input
              className={field}
              type="number"
              min={30}
              max={2555}
              value={draft.retentionDays}
              onChange={(e) => set('retentionDays', Number(e.target.value))}
            />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={busy || !dirty}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? t('common.loading') : t('settings.save')}
            </button>
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => setDraft(saved)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-60"
            >
              {t('settings.reset')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

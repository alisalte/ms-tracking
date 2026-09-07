import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { apiMessage } from '@/api/client';
import { type LicensePlanCode, provisionTenant } from '@/api/tenants';
import { PLAN_CODES, PLAN_PRESETS, addDaysIso, gibToBytes } from '@/lib/license';
import { estimateTotal, formatMoney } from '@/lib/money';

export function TenantCreatePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const loc = i18n.language.startsWith('fa') ? 'fa-IR' : 'en-GB';
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<LicensePlanCode>('STANDARD');
  const [region, setRegion] = useState('local');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [starts, setStarts] = useState(() => addDaysIso(0));
  const [expires, setExpires] = useState(() => addDaysIso(PLAN_PRESETS.STANDARD.durationDays));
  const [maxUsers, setMaxUsers] = useState(PLAN_PRESETS.STANDARD.maxUsers);
  const [maxVehicles, setMaxVehicles] = useState(PLAN_PRESETS.STANDARD.maxVehicles);
  const [maxDevices, setMaxDevices] = useState(PLAN_PRESETS.STANDARD.maxDevices);
  const [maxDrivers, setMaxDrivers] = useState(PLAN_PRESETS.STANDARD.maxDrivers);
  const [storageGib, setStorageGib] = useState(PLAN_PRESETS.STANDARD.storageGib);
  const [downloadGib, setDownloadGib] = useState(PLAN_PRESETS.STANDARD.downloadGib);
  const [sessions, setSessions] = useState(PLAN_PRESETS.STANDARD.sessions);
  const [idleMinutes, setIdleMinutes] = useState(PLAN_PRESETS.STANDARD.idleMinutes);
  const [absoluteHours, setAbsoluteHours] = useState(PLAN_PRESETS.STANDARD.absoluteHours);
  const [graceDays, setGraceDays] = useState(7);
  const [loginStart, setLoginStart] = useState('');
  const [loginEnd, setLoginEnd] = useState('');
  const [timezone, setTimezone] = useState('Asia/Tehran');
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState(PLAN_PRESETS.STANDARD.currency);
  const [basePrice, setBasePrice] = useState(PLAN_PRESETS.STANDARD.basePrice);
  const [unitUsers, setUnitUsers] = useState(PLAN_PRESETS.STANDARD.unitPriceUsers);
  const [unitVehicles, setUnitVehicles] = useState(PLAN_PRESETS.STANDARD.unitPriceVehicles);
  const [unitDevices, setUnitDevices] = useState(PLAN_PRESETS.STANDARD.unitPriceDevices);
  const [unitDrivers, setUnitDrivers] = useState(PLAN_PRESETS.STANDARD.unitPriceDrivers);
  const [unitStorage, setUnitStorage] = useState(PLAN_PRESETS.STANDARD.unitPriceStorageGib);
  const [unitDownload, setUnitDownload] = useState(PLAN_PRESETS.STANDARD.unitPriceDownloadGib);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyPlan = (next: LicensePlanCode) => {
    setPlan(next);
    const p = PLAN_PRESETS[next];
    setExpires(addDaysIso(p.durationDays));
    setMaxUsers(p.maxUsers);
    setMaxVehicles(p.maxVehicles);
    setMaxDevices(p.maxDevices);
    setMaxDrivers(p.maxDrivers);
    setStorageGib(p.storageGib);
    setDownloadGib(p.downloadGib);
    setSessions(p.sessions);
    setIdleMinutes(p.idleMinutes);
    setAbsoluteHours(p.absoluteHours);
    setCurrency(p.currency);
    setBasePrice(p.basePrice);
    setUnitUsers(p.unitPriceUsers);
    setUnitVehicles(p.unitPriceVehicles);
    setUnitDevices(p.unitPriceDevices);
    setUnitDrivers(p.unitPriceDrivers);
    setUnitStorage(p.unitPriceStorageGib);
    setUnitDownload(p.unitPriceDownloadGib);
  };

  const total = estimateTotal({
    basePrice,
    maxUsers,
    unitPriceUsers: unitUsers,
    maxVehicles,
    unitPriceVehicles: unitVehicles,
    maxDevices,
    unitPriceDevices: unitDevices,
    maxDrivers,
    unitPriceDrivers: unitDrivers,
    storageGib,
    unitPriceStorageGib: unitStorage,
    downloadGib,
    unitPriceDownloadGib: unitDownload,
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const preset = PLAN_PRESETS[plan];
      const created = await provisionTenant({
        name: name.trim(),
        tier: preset.tier,
        region: region.trim(),
        admin_email: adminEmail.trim(),
        admin_username: adminUsername.trim(),
        admin_password: adminPassword,
        license: {
          plan_code: plan,
          starts_at: starts,
          expires_at: expires,
          grace_days: graceDays,
          max_users: maxUsers,
          max_vehicles: maxVehicles,
          max_devices: maxDevices,
          max_drivers: maxDrivers,
          max_storage_bytes: gibToBytes(storageGib),
          max_download_bytes_month: gibToBytes(downloadGib),
          max_concurrent_sessions: sessions,
          session_idle_minutes: idleMinutes,
          session_absolute_hours: absoluteHours,
          login_hours_start: loginStart === '' ? null : Number(loginStart),
          login_hours_end: loginEnd === '' ? null : Number(loginEnd),
          timezone,
          notes: notes.trim() || null,
          currency,
          base_price: basePrice,
          unit_price_users: unitUsers,
          unit_price_vehicles: unitVehicles,
          unit_price_devices: unitDevices,
          unit_price_drivers: unitDrivers,
          unit_price_storage_gib: unitStorage,
          unit_price_download_gib: unitDownload,
        },
      });
      navigate(`/tenants/${created.tenant_id}`, { replace: true });
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-[1fr_240px]">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h1 className="text-xl font-bold">{t('create.title')}</h1>
          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <Field label={t('create.name')} value={name} onChange={setName} required />
          <label className="mt-4 block text-sm font-medium">
            {t('create.plan')}
            <select
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              value={plan}
              onChange={(ev) => applyPlan(ev.target.value as LicensePlanCode)}
            >
              {PLAN_CODES.map((x) => (
                <option key={x} value={x}>
                  {t(`plans.${x}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field
              label={t('create.starts')}
              value={starts}
              onChange={setStarts}
              type="date"
              required
            />
            <Field
              label={t('create.expires')}
              value={expires}
              onChange={setExpires}
              type="date"
              required
            />
          </div>
          <Field label={t('create.region')} value={region} onChange={setRegion} required />
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-semibold">{t('pricing.title')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('pricing.hint')}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <NumField label={t('pricing.base')} value={basePrice} onChange={setBasePrice} min={0} />
            <Field label={t('pricing.currency')} value={currency} onChange={setCurrency} />
            <NumField
              label={t('create.maxVehicles')}
              value={maxVehicles}
              onChange={setMaxVehicles}
            />
            <NumField
              label={t('pricing.perVehicle')}
              value={unitVehicles}
              onChange={setUnitVehicles}
              min={0}
            />
            <NumField label={t('create.maxUsers')} value={maxUsers} onChange={setMaxUsers} />
            <NumField
              label={t('pricing.perUser')}
              value={unitUsers}
              onChange={setUnitUsers}
              min={0}
            />
            <NumField label={t('create.maxDevices')} value={maxDevices} onChange={setMaxDevices} />
            <NumField
              label={t('pricing.perDevice')}
              value={unitDevices}
              onChange={setUnitDevices}
              min={0}
            />
            <NumField label={t('create.maxDrivers')} value={maxDrivers} onChange={setMaxDrivers} />
            <NumField
              label={t('pricing.perDriver')}
              value={unitDrivers}
              onChange={setUnitDrivers}
              min={0}
            />
            <NumField
              label={t('create.storageGib')}
              value={storageGib}
              onChange={setStorageGib}
              min={0}
            />
            <NumField
              label={t('pricing.perStorage')}
              value={unitStorage}
              onChange={setUnitStorage}
              min={0}
            />
            <NumField
              label={t('create.downloadGib')}
              value={downloadGib}
              onChange={setDownloadGib}
              min={0}
            />
            <NumField
              label={t('pricing.perDownload')}
              value={unitDownload}
              onChange={setUnitDownload}
              min={0}
            />
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="font-semibold">{t('create.adminSection')}</h2>
          <Field
            label={t('create.adminEmail')}
            value={adminEmail}
            onChange={setAdminEmail}
            type="email"
            required
          />
          <Field
            label={t('create.adminUsername')}
            value={adminUsername}
            onChange={setAdminUsername}
            required
          />
          <label className="mt-4 block text-sm font-medium">
            {t('create.adminPassword')}
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              value={adminPassword}
              onChange={(ev) => setAdminPassword(ev.target.value)}
              required
              minLength={12}
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {t('create.passwordHint')}
            </span>
          </label>
        </div>

        <details className="rounded-2xl border border-stone-200 bg-white p-6">
          <summary className="cursor-pointer text-sm font-semibold">{t('create.advanced')}</summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <NumField label={t('create.sessions')} value={sessions} onChange={setSessions} />
            <NumField
              label={t('create.idleMinutes')}
              value={idleMinutes}
              onChange={setIdleMinutes}
            />
            <NumField
              label={t('create.absoluteHours')}
              value={absoluteHours}
              onChange={setAbsoluteHours}
            />
            <NumField
              label={t('create.graceDays')}
              value={graceDays}
              onChange={setGraceDays}
              min={0}
            />
            <label className="block text-sm font-medium">
              {t('create.loginStart')}
              <input
                className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                type="number"
                min={0}
                max={23}
                placeholder={t('create.unrestricted')}
                value={loginStart}
                onChange={(e) => setLoginStart(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              {t('create.loginEnd')}
              <input
                className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                type="number"
                min={0}
                max={23}
                placeholder={t('create.unrestricted')}
                value={loginEnd}
                onChange={(e) => setLoginEnd(e.target.value)}
              />
            </label>
            <Field label={t('create.timezone')} value={timezone} onChange={setTimezone} />
          </div>
          <label className="mt-3 block text-sm font-medium">
            {t('create.notes')}
            <textarea
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </details>
      </div>

      <aside className="h-fit rounded-2xl border border-stone-200 bg-ink-950 p-5 text-slate-200 lg:sticky lg:top-6">
        <p className="text-xs text-slate-400">{t('pricing.estimate')}</p>
        <p className="mt-2 text-2xl font-bold text-white">{formatMoney(total, currency, loc)}</p>
        <p className="mt-2 text-xs text-slate-400">{t('pricing.periodHint')}</p>
        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-xl bg-brand-500 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
        >
          {busy ? t('common.loading') : t('create.submit')}
        </button>
      </aside>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="mt-4 block text-sm font-medium">
      {label}
      <input
        type={type}
        className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
  min = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        type="number"
        min={min}
        className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

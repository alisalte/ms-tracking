import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { apiMessage } from '@/api/client';
import { type LicensePlanCode, provisionTenant } from '@/api/tenants';
import { PLAN_CODES, PLAN_PRESETS, addDaysIso, gibToBytes } from '@/lib/license';

export function TenantCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
  };

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
    <form
      onSubmit={onSubmit}
      className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-6"
    >
      <h1 className="text-xl font-bold">{t('create.title')}</h1>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Field label={t('create.name')} value={name} onChange={setName} required />
      <label className="mt-4 block text-sm font-medium">
        {t('create.plan')}
        <select
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
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
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={adminPassword}
          onChange={(ev) => setAdminPassword(ev.target.value)}
          required
          minLength={12}
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          {t('create.passwordHint')}
        </span>
      </label>

      <details className="mt-6 rounded-xl border border-slate-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold">{t('create.advanced')}</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <NumField label={t('create.maxUsers')} value={maxUsers} onChange={setMaxUsers} />
          <NumField label={t('create.maxVehicles')} value={maxVehicles} onChange={setMaxVehicles} />
          <NumField label={t('create.maxDevices')} value={maxDevices} onChange={setMaxDevices} />
          <NumField label={t('create.maxDrivers')} value={maxDrivers} onChange={setMaxDrivers} />
          <NumField
            label={t('create.storageGib')}
            value={storageGib}
            onChange={setStorageGib}
            min={0}
          />
          <NumField
            label={t('create.downloadGib')}
            value={downloadGib}
            onChange={setDownloadGib}
            min={0}
          />
          <NumField label={t('create.sessions')} value={sessions} onChange={setSessions} />
          <NumField label={t('create.idleMinutes')} value={idleMinutes} onChange={setIdleMinutes} />
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
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
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
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
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
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </details>

      <button
        type="submit"
        disabled={busy}
        className="mt-6 rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {busy ? t('common.loading') : t('create.submit')}
      </button>
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
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
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
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

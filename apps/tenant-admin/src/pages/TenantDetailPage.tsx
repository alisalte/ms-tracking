import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { apiMessage } from '@/api/client';
import {
  type LicensePlanCode,
  type QuotaMeter,
  type TenantRow,
  type TenantUser,
  createTenantUser,
  getTenant,
  listTenantUsers,
  setTenantUserStatus,
  updateTenantLicense,
  updateTenantUsage,
} from '@/api/tenants';
import { PLAN_CODES, bytesToGib, gibToBytes, isoDateOnly } from '@/lib/license';

const ROLES = ['tenant-admin', 'fleet-admin', 'viewer'] as const;

export function TenantDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<TenantRow | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('viewer');
  const [busy, setBusy] = useState(false);
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [usageBusy, setUsageBusy] = useState(false);

  const loc = i18n.language.startsWith('fa') ? 'fa-IR-u-ca-persian' : 'en-GB';

  const reload = async () => {
    if (!id) return;
    setError(null);
    try {
      const [tnt, list] = await Promise.all([getTenant(id), listTenantUsers(id)]);
      setTenant(tnt);
      setUsers(list);
    } catch (err) {
      setError(apiMessage(err));
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the route id changes.
  useEffect(() => {
    void reload();
  }, [id]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createTenantUser(id, {
        email: email.trim(),
        username: username.trim(),
        password,
        display_name: displayName.trim() || undefined,
        role_name: role,
      });
      setEmail('');
      setUsername('');
      setPassword('');
      setDisplayName('');
      setNotice(t('detail.userCreated'));
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!id) return null;
  const license = tenant?.license;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/" className="text-sm text-brand-600 no-underline">
          ← {t('common.back')}
        </Link>
        <h1 className="mt-2 text-xl font-bold">{tenant?.name ?? t('detail.title')}</h1>
        {tenant && (
          <p className="mt-1 text-sm text-slate-500">
            {tenant.tier} · {tenant.region} · {tenant.status}
          </p>
        )}
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      )}

      {license && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t('tenants.license')}</h2>
              <p className="mt-1 font-mono text-sm text-slate-600">{license.license_key}</p>
            </div>
            <StatusPill status={license.license_status} />
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat label={t('create.plan')} value={t(`plans.${license.plan_code}`)} />
            <Stat
              label={t('create.starts')}
              value={new Date(license.starts_at).toLocaleDateString(loc)}
            />
            <Stat
              label={t('create.expires')}
              value={new Date(license.expires_at).toLocaleDateString(loc)}
            />
            <Stat
              label={t('tenants.remaining')}
              value={
                license.days_remaining >= 0
                  ? t('detail.daysLeft', { count: license.days_remaining })
                  : t('detail.expiredAgo', { count: Math.abs(license.days_remaining) })
              }
            />
          </dl>
        </section>
      )}

      {license && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold">{t('detail.quotas')}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MeterCard title={t('meter.users')} meter={license.quotas.users} />
            <MeterCard title={t('meter.vehicles')} meter={license.quotas.vehicles} />
            <MeterCard title={t('meter.devices')} meter={license.quotas.devices} />
            <MeterCard title={t('meter.drivers')} meter={license.quotas.drivers} />
            <MeterCard
              title={t('meter.storage')}
              meter={license.quotas.storage_bytes}
              format={(n) => `${bytesToGib(n)} GiB`}
            />
            <MeterCard
              title={t('meter.download')}
              meter={license.quotas.download_bytes_month}
              format={(n) => `${bytesToGib(n)} GiB`}
            />
          </div>
        </section>
      )}

      {license && (
        <LicenseEditor
          tenantId={id}
          license={license}
          busy={licenseBusy}
          onSave={async (fields) => {
            setLicenseBusy(true);
            setError(null);
            setNotice(null);
            try {
              const next = await updateTenantLicense(id, fields);
              setTenant(next);
              setNotice(t('detail.licenseSaved'));
            } catch (err) {
              setError(apiMessage(err));
            } finally {
              setLicenseBusy(false);
            }
          }}
        />
      )}

      {license && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold">{t('detail.usageTitle')}</h2>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const storage = Number(
                (form.elements.namedItem('storage_gib') as HTMLInputElement).value,
              );
              const download = Number(
                (form.elements.namedItem('download_gib') as HTMLInputElement).value,
              );
              setUsageBusy(true);
              setError(null);
              setNotice(null);
              void updateTenantUsage(id, {
                storage_bytes: gibToBytes(storage),
                download_bytes_month: gibToBytes(download),
              })
                .then((next) => {
                  setTenant(next);
                  setNotice(t('detail.usageSaved'));
                })
                .catch((err) => setError(apiMessage(err)))
                .finally(() => setUsageBusy(false));
            }}
          >
            <label className="text-sm font-medium">
              {t('detail.storageUsedGib')}
              <input
                name="storage_gib"
                type="number"
                min={0}
                step={0.01}
                defaultValue={bytesToGib(license.quotas.storage_bytes.used)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm font-medium">
              {t('detail.downloadUsedGib')}
              <input
                name="download_gib"
                type="number"
                min={0}
                step={0.01}
                defaultValue={bytesToGib(license.quotas.download_bytes_month.used)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              disabled={usageBusy}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2"
            >
              {usageBusy ? t('common.loading') : t('detail.saveUsage')}
            </button>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">{t('detail.addUser')}</h2>
        <form onSubmit={onCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('detail.displayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? t('common.loading') : t('detail.submitUser')}
          </button>
        </form>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <h2 className="px-4 pt-4 font-semibold">{t('detail.users')}</h2>
        <table className="mt-2 w-full text-sm">
          <thead className="text-start text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{t('detail.email')}</th>
              <th className="px-4 py-2 font-medium">{t('detail.username')}</th>
              <th className="px-4 py-2 font-medium">{t('detail.role')}</th>
              <th className="px-4 py-2 font-medium">{t('detail.status')}</th>
              <th className="px-4 py-2 font-medium">{t('tenants.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.username}</td>
                <td className="px-4 py-2">{u.roles.join(', ') || '—'}</td>
                <td className="px-4 py-2">{u.status}</td>
                <td className="px-4 py-2">
                  {u.status === 'ACTIVE' ? (
                    <button
                      type="button"
                      className="text-amber-700"
                      onClick={() => void setTenantUserStatus(id, u.id, 'suspended').then(reload)}
                    >
                      {t('detail.suspendUser')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-emerald-700"
                      onClick={() => void setTenantUserStatus(id, u.id, 'active').then(reload)}
                    >
                      {t('detail.activateUser')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone =
    status === 'ACTIVE'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'GRACE'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-red-50 text-red-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {t(`licenseStatus.${status}`)}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

function MeterCard({
  title,
  meter,
  format = String,
}: {
  title: string;
  meter: QuotaMeter;
  format?: (n: number) => string;
}) {
  const color =
    meter.state === 'exceeded'
      ? 'bg-red-500'
      : meter.state === 'warn'
        ? 'bg-amber-500'
        : 'bg-brand-500';
  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="tabular-nums text-slate-500">
          {format(meter.used)} / {format(meter.limit)}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, meter.pct)}%` }} />
      </div>
    </div>
  );
}

function LicenseEditor({
  tenantId,
  license,
  busy,
  onSave,
}: {
  tenantId: string;
  license: NonNullable<TenantRow['license']>;
  busy: boolean;
  onSave: (fields: Parameters<typeof updateTenantLicense>[1]) => Promise<void>;
}) {
  void tenantId;
  const { t } = useTranslation();
  const [plan, setPlan] = useState<LicensePlanCode>(license.plan_code);
  const [starts, setStarts] = useState(isoDateOnly(license.starts_at));
  const [expires, setExpires] = useState(isoDateOnly(license.expires_at));
  const [maxUsers, setMaxUsers] = useState(license.quotas.users.limit);
  const [maxVehicles, setMaxVehicles] = useState(license.quotas.vehicles.limit);
  const [maxDevices, setMaxDevices] = useState(license.quotas.devices.limit);
  const [maxDrivers, setMaxDrivers] = useState(license.quotas.drivers.limit);
  const [storageGib, setStorageGib] = useState(bytesToGib(license.quotas.storage_bytes.limit));
  const [downloadGib, setDownloadGib] = useState(
    bytesToGib(license.quotas.download_bytes_month.limit),
  );
  const [sessions, setSessions] = useState(license.max_concurrent_sessions);
  const [idleMinutes, setIdleMinutes] = useState(license.session_idle_minutes);
  const [absoluteHours, setAbsoluteHours] = useState(license.session_absolute_hours);
  const [graceDays, setGraceDays] = useState(license.grace_days);
  const [loginStart, setLoginStart] = useState(
    license.login_hours_start == null ? '' : String(license.login_hours_start),
  );
  const [loginEnd, setLoginEnd] = useState(
    license.login_hours_end == null ? '' : String(license.login_hours_end),
  );
  const [timezone, setTimezone] = useState(license.timezone);
  const [notes, setNotes] = useState(license.notes ?? '');

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold">{t('detail.sessionPolicy')}</h2>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
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
          });
        }}
      >
        <label className="text-sm font-medium">
          {t('create.plan')}
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={plan}
            onChange={(e) => setPlan(e.target.value as LicensePlanCode)}
          >
            {PLAN_CODES.map((p) => (
              <option key={p} value={p}>
                {t(`plans.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          {t('create.expires')}
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium">
          {t('create.starts')}
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </label>
        <Num label={t('create.graceDays')} value={graceDays} onChange={setGraceDays} min={0} />
        <Num label={t('create.maxUsers')} value={maxUsers} onChange={setMaxUsers} />
        <Num label={t('create.maxVehicles')} value={maxVehicles} onChange={setMaxVehicles} />
        <Num label={t('create.maxDevices')} value={maxDevices} onChange={setMaxDevices} />
        <Num label={t('create.maxDrivers')} value={maxDrivers} onChange={setMaxDrivers} />
        <Num label={t('create.storageGib')} value={storageGib} onChange={setStorageGib} min={0} />
        <Num
          label={t('create.downloadGib')}
          value={downloadGib}
          onChange={setDownloadGib}
          min={0}
        />
        <Num label={t('create.sessions')} value={sessions} onChange={setSessions} />
        <Num label={t('create.idleMinutes')} value={idleMinutes} onChange={setIdleMinutes} />
        <Num label={t('create.absoluteHours')} value={absoluteHours} onChange={setAbsoluteHours} />
        <label className="text-sm font-medium">
          {t('create.loginStart')}
          <input
            type="number"
            min={0}
            max={23}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder={t('create.unrestricted')}
            value={loginStart}
            onChange={(e) => setLoginStart(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium">
          {t('create.loginEnd')}
          <input
            type="number"
            min={0}
            max={23}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder={t('create.unrestricted')}
            value={loginEnd}
            onChange={(e) => setLoginEnd(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          {t('create.timezone')}
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          {t('create.notes')}
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2"
        >
          {busy ? t('common.loading') : t('detail.saveLicense')}
        </button>
      </form>
    </section>
  );
}

function Num({
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
    <label className="text-sm font-medium">
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

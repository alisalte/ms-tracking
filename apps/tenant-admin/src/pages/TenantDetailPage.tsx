import { FileText } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { type Invoice, generateInvoice, listInvoices } from '@/api/billing';
import { apiMessage } from '@/api/client';
import {
  type LicensePlanCode,
  type TenantLicense,
  type TenantRow,
  type TenantUser,
  createTenantUser,
  getTenant,
  listTenantUsers,
  setTenantUserStatus,
  updateTenantLicense,
  updateTenantUsage,
} from '@/api/tenants';
import { EmptyState } from '@/components/EmptyState';
import { QuotaMeterCard } from '@/components/QuotaMeter';
import { PLAN_CODES, bytesToGib, gibToBytes, isoDateOnly } from '@/lib/license';
import { formatMoney } from '@/lib/money';

const ROLES = ['tenant-admin', 'fleet-admin', 'viewer'] as const;

export function TenantDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<TenantRow | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
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
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  const loc = i18n.language.startsWith('fa') ? 'fa-IR-u-ca-persian' : 'en-GB';

  const reload = async () => {
    if (!id) return;
    setError(null);
    try {
      const [tnt, list, inv] = await Promise.all([
        getTenant(id),
        listTenantUsers(id),
        listInvoices(id),
      ]);
      setTenant(tnt);
      setUsers(list);
      setInvoices(inv);
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

  const [tab, setTab] = useState<'overview' | 'rates' | 'invoices' | 'access'>('overview');

  if (!id) return null;
  const license = tenant?.license;
  const tabs = [
    { id: 'overview' as const, label: t('detail.tabOverview') },
    { id: 'rates' as const, label: t('detail.tabRates') },
    { id: 'invoices' as const, label: t('detail.tabInvoices') },
    { id: 'access' as const, label: t('detail.tabAccess') },
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/tenants" className="text-sm text-brand-600 no-underline">
          ← {t('common.back')}
        </Link>
        {tenant && (
          <p className="text-xs text-slate-500">
            {tenant.region} · {tenant.status}
          </p>
        )}
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      )}

      {license && (
        <LicenseHero name={tenant?.name ?? t('detail.title')} license={license} loc={loc} />
      )}

      <div className="flex gap-1 overflow-x-auto rounded-lg bg-stone-200/70 p-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === item.id ? 'bg-white font-semibold text-ink-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && license && (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold">{t('detail.quotas')}</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <QuotaMeterCard title={t('meter.users')} meter={license.quotas.users} />
            <QuotaMeterCard title={t('meter.vehicles')} meter={license.quotas.vehicles} />
            <QuotaMeterCard title={t('meter.devices')} meter={license.quotas.devices} />
            <QuotaMeterCard title={t('meter.drivers')} meter={license.quotas.drivers} />
            <QuotaMeterCard
              title={t('meter.storage')}
              meter={license.quotas.storage_bytes}
              format={(n) => `${bytesToGib(n)} GiB`}
            />
            <QuotaMeterCard
              title={t('meter.download')}
              meter={license.quotas.download_bytes_month}
              format={(n) => `${bytesToGib(n)} GiB`}
            />
          </div>
          <form
            className="mt-3 grid gap-2 border-t border-stone-100 pt-3 sm:grid-cols-[1fr_1fr_auto]"
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
            <label className="text-xs font-medium text-slate-600">
              {t('detail.storageUsedGib')}
              <input
                name="storage_gib"
                type="number"
                min={0}
                step={0.01}
                defaultValue={bytesToGib(license.quotas.storage_bytes.used)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('detail.downloadUsedGib')}
              <input
                name="download_gib"
                type="number"
                min={0}
                step={0.01}
                defaultValue={bytesToGib(license.quotas.download_bytes_month.used)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={usageBusy}
              className="self-end rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {usageBusy ? t('common.loading') : t('detail.saveUsage')}
            </button>
          </form>
        </section>
      )}

      {tab === 'rates' && license && (
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

      {tab === 'invoices' && license && (
        <InvoicePanel
          invoices={invoices}
          busy={invoiceBusy}
          loc={loc}
          currency={license.currency}
          onGenerate={async () => {
            setInvoiceBusy(true);
            setError(null);
            setNotice(null);
            try {
              await generateInvoice(id);
              setNotice(t('invoices.created'));
              await reload();
            } catch (err) {
              setError(apiMessage(err));
            } finally {
              setInvoiceBusy(false);
            }
          }}
        />
      )}

      {tab === 'access' && (
        <>
          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold">{t('detail.addUser')}</h2>
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

          <section className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
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
                          onClick={() =>
                            void setTenantUserStatus(id, u.id, 'suspended').then(reload)
                          }
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
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone =
    status === 'ACTIVE'
      ? 'bg-emerald-400/20 text-emerald-100'
      : status === 'GRACE'
        ? 'bg-amber-400/20 text-amber-100'
        : 'bg-red-400/20 text-red-100';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {t(`licenseStatus.${status}`)}
    </span>
  );
}

function periodElapsedPct(starts: string, expires: string): number {
  const a = new Date(starts).getTime();
  const b = new Date(expires).getTime();
  if (b <= a) return 0;
  return Math.min(100, Math.max(0, ((Date.now() - a) / (b - a)) * 100));
}

function LicenseHero({
  name,
  license,
  loc,
}: {
  name: string;
  license: TenantLicense;
  loc: string;
}) {
  const { t } = useTranslation();
  const remaining = license.days_remaining;
  const elapsed = periodElapsedPct(license.starts_at, license.expires_at);
  const remainingTone =
    remaining < 0 ? 'text-red-200' : remaining <= 30 ? 'text-amber-200' : 'text-white';
  return (
    <section className="rounded-xl bg-ink-900 p-4 text-slate-200 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold">
              {t(`plans.${license.plan_code}`)}
            </span>
            <StatusPill status={license.license_status} />
          </div>
          <h2 className="mt-2 truncate text-xl font-bold text-white">{name}</h2>
          <p className="mt-1 font-mono text-[11px] text-slate-400">{license.license_key}</p>
        </div>
        <div className="text-end">
          <p className={`text-3xl font-bold tabular-nums leading-none ${remainingTone}`}>
            {Math.abs(remaining)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {remaining >= 0 ? t('detail.remainingLabel') : t('detail.overdueLabel')}
          </p>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-brand-500" style={{ width: `${elapsed}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
        <span>
          {t('create.starts')}: {new Date(license.starts_at).toLocaleDateString(loc)}
        </span>
        <span>
          {t('create.expires')}: {new Date(license.expires_at).toLocaleDateString(loc)}
        </span>
        <span className="font-semibold text-white">
          {formatMoney(license.estimated_total, license.currency, loc)}
        </span>
      </div>
    </section>
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
  const [currency, setCurrency] = useState(license.currency ?? 'IRR');
  const [basePrice, setBasePrice] = useState(license.base_price ?? 0);
  const [unitUsers, setUnitUsers] = useState(license.unit_price_users ?? 0);
  const [unitVehicles, setUnitVehicles] = useState(license.unit_price_vehicles ?? 0);
  const [unitDevices, setUnitDevices] = useState(license.unit_price_devices ?? 0);
  const [unitDrivers, setUnitDrivers] = useState(license.unit_price_drivers ?? 0);
  const [unitStorage, setUnitStorage] = useState(license.unit_price_storage_gib ?? 0);
  const [unitDownload, setUnitDownload] = useState(license.unit_price_download_gib ?? 0);

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{t('detail.sessionPolicy')}</h2>
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
            currency,
            base_price: basePrice,
            unit_price_users: unitUsers,
            unit_price_vehicles: unitVehicles,
            unit_price_devices: unitDevices,
            unit_price_drivers: unitDrivers,
            unit_price_storage_gib: unitStorage,
            unit_price_download_gib: unitDownload,
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
        <Num label={t('pricing.base')} value={basePrice} onChange={setBasePrice} min={0} />
        <label className="text-sm font-medium">
          {t('pricing.currency')}
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
        </label>
        <Num
          label={t('pricing.perVehicle')}
          value={unitVehicles}
          onChange={setUnitVehicles}
          min={0}
        />
        <Num label={t('pricing.perUser')} value={unitUsers} onChange={setUnitUsers} min={0} />
        <Num label={t('pricing.perDevice')} value={unitDevices} onChange={setUnitDevices} min={0} />
        <Num label={t('pricing.perDriver')} value={unitDrivers} onChange={setUnitDrivers} min={0} />
        <Num
          label={t('pricing.perStorage')}
          value={unitStorage}
          onChange={setUnitStorage}
          min={0}
        />
        <Num
          label={t('pricing.perDownload')}
          value={unitDownload}
          onChange={setUnitDownload}
          min={0}
        />
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

function InvoicePanel({
  invoices,
  busy,
  loc,
  currency,
  onGenerate,
}: {
  invoices: Invoice[];
  busy: boolean;
  loc: string;
  currency: string;
  onGenerate: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const generateBtn = (
    <button
      type="button"
      disabled={busy}
      className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      onClick={() => void onGenerate()}
    >
      {busy ? t('common.loading') : t('invoices.generate')}
    </button>
  );
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      {invoices.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title={t('invoices.emptyTitle')}
          body={t('invoices.generateHint')}
          action={generateBtn}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t('invoices.title')}</h2>
            {generateBtn}
          </div>
          <table className="mt-4 w-full text-sm">
            <thead className="text-start text-slate-500">
              <tr>
                <th className="py-2 font-medium">{t('invoices.number')}</th>
                <th className="py-2 font-medium">{t('invoices.status')}</th>
                <th className="py-2 font-medium">{t('invoices.total')}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-stone-100">
                  <td className="py-2">
                    <Link to={`/invoices/${inv.id}`} className="text-brand-600 no-underline">
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="py-2">{t(`invoiceStatus.${inv.status}`)}</td>
                  <td className="py-2 tabular-nums">
                    {formatMoney(inv.total_amount, inv.currency || currency, loc)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

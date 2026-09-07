import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { apiMessage } from '@/api/client';
import {
  type TenantLicense,
  type TenantRow,
  listTenants,
  reactivateTenant,
  suspendTenant,
} from '@/api/tenants';
import { MiniQuotaRow } from '@/components/QuotaMeter';
import { bytesToGib } from '@/lib/license';
import { formatMoney } from '@/lib/money';

export function TenantsPage() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    setError(null);
    try {
      setRows(await listTenants());
    } catch (err) {
      setError(apiMessage(err));
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only fetch; reload is reused after mutations.
  useEffect(() => {
    void reload();
  }, []);

  const onSuspend = async (id: string) => {
    if (!window.confirm(t('tenants.confirmSuspend'))) return;
    setBusyId(id);
    try {
      await suspendTenant(id);
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onReactivate = async (id: string) => {
    setBusyId(id);
    try {
      await reactivateTenant(id);
      await reload();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const loc = i18n.language.startsWith('fa') ? 'fa-IR-u-ca-persian' : 'en-GB';

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">{t('tenants.listHint')}</p>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rows.length === 0 && !error ? (
        <p className="text-slate-500">{t('tenants.empty')}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-start text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t('tenants.name')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.license')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.remaining')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.usage')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.amount')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.status')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.created')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">
                    {r.name}
                    <div className="text-xs font-normal text-slate-400">{r.region}</div>
                  </td>
                  <td className="px-4 py-3">
                    <LicenseBadge license={r.license} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{remainingLabel(r.license, t)}</td>
                  <td className="px-4 py-3">
                    <MiniMeters license={r.license} />
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums text-slate-700">
                    {r.license
                      ? formatMoney(r.license.estimated_total, r.license.currency, loc)
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        r.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-700'
                          : r.status === 'SUSPENDED'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString(loc) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link to={`/tenants/${r.id}`} className="text-brand-600 no-underline">
                        {t('tenants.open')}
                      </Link>
                      {r.status === 'ACTIVE' && (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          className="text-amber-700"
                          onClick={() => void onSuspend(r.id)}
                        >
                          {t('tenants.suspend')}
                        </button>
                      )}
                      {r.status === 'SUSPENDED' && (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          className="text-emerald-700"
                          onClick={() => void onReactivate(r.id)}
                        >
                          {t('tenants.reactivate')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LicenseBadge({ license }: { license?: TenantLicense | null }) {
  const { t } = useTranslation();
  if (!license) return <span className="text-slate-400">—</span>;
  const tone =
    license.license_status === 'ACTIVE'
      ? 'bg-emerald-50 text-emerald-700'
      : license.license_status === 'GRACE'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-red-50 text-red-700';
  return (
    <div>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
        {t(`licenseStatus.${license.license_status}`)}
      </span>
      <div className="mt-1 text-xs text-slate-500">{t(`plans.${license.plan_code}`)}</div>
    </div>
  );
}

function remainingLabel(
  license: TenantLicense | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!license) return '—';
  const n = license.days_remaining;
  if (n >= 0) return t('detail.daysLeft', { count: n });
  return t('detail.expiredAgo', { count: Math.abs(n) });
}

function MiniMeters({ license }: { license?: TenantLicense | null }) {
  const { t } = useTranslation();
  if (!license) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex min-w-44 flex-col gap-1.5">
      <MiniQuotaRow meter={license.quotas.vehicles} label={t('meter.vehicles')} />
      <MiniQuotaRow meter={license.quotas.users} label={t('meter.users')} />
      <MiniQuotaRow
        meter={{
          ...license.quotas.storage_bytes,
          used: bytesToGib(license.quotas.storage_bytes.used),
          limit: bytesToGib(license.quotas.storage_bytes.limit),
        }}
        label={t('meter.storage')}
      />
    </div>
  );
}

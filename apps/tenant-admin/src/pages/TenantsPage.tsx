import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { apiMessage } from '@/api/client';
import { type TenantRow, listTenants, reactivateTenant, suspendTenant } from '@/api/tenants';

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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('tenants.title')}</h1>
        <Link
          to="/new"
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white no-underline"
        >
          {t('nav.create')}
        </Link>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rows.length === 0 && !error ? (
        <p className="text-slate-500">{t('tenants.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-start text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t('tenants.name')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.tier')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.region')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.status')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.created')}</th>
                <th className="px-4 py-3 font-medium">{t('tenants.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3">{r.tier}</td>
                  <td className="px-4 py-3">{r.region}</td>
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
                    {r.created_at
                      ? new Date(r.created_at).toLocaleDateString(
                          i18n.language.startsWith('fa') ? 'fa-IR-u-ca-persian' : 'en-GB',
                        )
                      : '—'}
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

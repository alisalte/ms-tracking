import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { type BillingDashboard, getReport } from '@/api/billing';
import { apiMessage } from '@/api/client';
import { formatMoney } from '@/lib/money';

export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<BillingDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loc = i18n.language.startsWith('fa') ? 'fa-IR' : 'en-GB';

  useEffect(() => {
    void getReport()
      .then(setData)
      .catch((err) => setError(apiMessage(err)));
  }, []);

  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  }
  if (!data) return <p className="text-slate-500">{t('common.loading')}</p>;

  const currency = data.kpis.currency;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          className="no-print rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-semibold text-white"
          onClick={() => window.print()}
        >
          {t('invoices.print')}
        </button>
      </div>

      <section className="print-sheet rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">{t('reports.byTenant')}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-start text-slate-500">
              <tr>
                <th className="py-2 font-medium">{t('tenants.name')}</th>
                <th className="py-2 font-medium">{t('create.plan')}</th>
                <th className="py-2 font-medium">{t('pricing.estimate')}</th>
                <th className="py-2 font-medium">{t('reports.invoiced')}</th>
                <th className="py-2 font-medium">{t('dash.outstanding')}</th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((row) => (
                <tr key={row.tenant_id} className="border-t border-stone-100">
                  <td className="py-2">
                    <Link to={`/tenants/${row.tenant_id}`} className="text-brand-600 no-underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-2">{row.plan_code ? t(`plans.${row.plan_code}`) : '—'}</td>
                  <td className="py-2 tabular-nums">
                    {formatMoney(row.contracted, currency, loc)}
                  </td>
                  <td className="py-2 tabular-nums">{formatMoney(row.invoiced, currency, loc)}</td>
                  <td className="py-2 tabular-nums">{formatMoney(row.unpaid, currency, loc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="print-sheet rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">{t('dash.byPlan')}</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-start text-slate-500">
            <tr>
              <th className="py-2 font-medium">{t('create.plan')}</th>
              <th className="py-2 font-medium">{t('dash.tenants')}</th>
              <th className="py-2 font-medium">{t('dash.contracted')}</th>
            </tr>
          </thead>
          <tbody>
            {data.by_plan.map((row) => (
              <tr key={row.plan_code} className="border-t border-stone-100">
                <td className="py-2">
                  {t(`plans.${row.plan_code}`, { defaultValue: row.plan_code })}
                </td>
                <td className="py-2 tabular-nums">{row.count}</td>
                <td className="py-2 tabular-nums">{formatMoney(row.contracted, currency, loc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

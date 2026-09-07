import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { type BillingDashboard, getDashboard } from '@/api/billing';
import { apiMessage } from '@/api/client';
import { formatMoney } from '@/lib/money';

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<BillingDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loc = i18n.language.startsWith('fa') ? 'fa-IR' : 'en-GB';
  const currency = data?.kpis.currency ?? 'IRR';

  useEffect(() => {
    void getDashboard()
      .then(setData)
      .catch((err) => setError(apiMessage(err)));
  }, []);

  if (error) {
    return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  }
  if (!data) {
    return <p className="text-slate-500">{t('common.loading')}</p>;
  }

  const k = data.kpis;
  const maxPlan = Math.max(1, ...data.by_plan.map((p) => p.contracted));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={t('dash.tenants')}
          value={String(k.tenants)}
          hint={t('dash.activeOf', { n: k.tenants_active })}
        />
        <Kpi
          label={t('dash.contracted')}
          value={formatMoney(k.contracted, currency, loc)}
          hint={t('dash.expiring', { n: k.expiring_soon })}
        />
        <Kpi
          label={t('dash.collected')}
          value={formatMoney(k.invoiced_collected, currency, loc)}
          hint={t('dash.invoicesIssued', { n: k.invoices_issued })}
        />
        <Kpi
          label={t('dash.outstanding')}
          value={formatMoney(k.invoiced_outstanding, currency, loc)}
          hint={t('dash.expiredLicenses', { n: k.licenses_expired })}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold">{t('dash.byPlan')}</h2>
          <div className="mt-4 flex flex-col gap-3">
            {data.by_plan.length === 0 && (
              <p className="text-sm text-slate-500">{t('tenants.empty')}</p>
            )}
            {data.by_plan.map((row) => (
              <div key={row.plan_code}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{t(`plans.${row.plan_code}`, { defaultValue: row.plan_code })}</span>
                  <span className="tabular-nums text-slate-500">
                    {row.count} · {formatMoney(row.contracted, currency, loc)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full bg-brand-500"
                    style={{ width: `${Math.round((row.contracted / maxPlan) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold">{t('dash.recentInvoices')}</h2>
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {data.recent_invoices.length === 0 && (
              <li className="py-6 text-center text-sm text-slate-500">
                {t('invoices.emptyTitle')}
              </li>
            )}
            {data.recent_invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between py-2">
                <Link
                  to={`/invoices/${inv.id}`}
                  className="font-medium text-brand-600 no-underline"
                >
                  {inv.invoice_number}
                </Link>
                <span className="text-slate-500">{inv.tenant_name}</span>
                <span className="tabular-nums">
                  {formatMoney(inv.total_amount, inv.currency, loc)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums leading-tight">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{hint}</p>
    </div>
  );
}

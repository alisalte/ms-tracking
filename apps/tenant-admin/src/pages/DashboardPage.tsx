import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { type BillingDashboard, getDashboard } from '@/api/billing';
import { apiMessage } from '@/api/client';
import { ApexChart, ChartPanel } from '@/components/ApexChart';
import { INVOICE_STATUS_COLORS, LICENSE_STATUS_COLORS, chartBase } from '@/lib/chart-theme';
import { formatCompactNumber, formatMoney } from '@/lib/money';

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

  return <DashboardBody data={data} loc={loc} currency={currency} />;
}

function DashboardBody({
  data,
  loc,
  currency,
}: {
  data: BillingDashboard;
  loc: string;
  currency: string;
}) {
  const { t } = useTranslation();
  const k = data.kpis;
  const billed = k.invoiced_collected + k.invoiced_outstanding;
  const collectionPct = billed > 0 ? Math.round((k.invoiced_collected / billed) * 100) : 0;

  const planLabels = data.by_plan.map((row) =>
    t(`plans.${row.plan_code}`, { defaultValue: row.plan_code }),
  );
  const planValues = data.by_plan.map((row) => row.contracted);
  const planCounts = data.by_plan.map((row) => row.count);

  const topTenants = [...data.tenants].sort((a, b) => b.contracted - a.contracted).slice(0, 8);
  const tenantLabels = topTenants.map((row) =>
    row.name.length > 22 ? `${row.name.slice(0, 20)}…` : row.name,
  );
  const tenantValues = topTenants.map((row) => row.contracted);

  const licenseEntries = useMemo(
    () =>
      (
        [
          ['ACTIVE', data.license_status.ACTIVE],
          ['GRACE', data.license_status.GRACE],
          ['EXPIRED', data.license_status.EXPIRED],
          ['NONE', data.license_status.NONE],
        ] as const
      ).filter(([, n]) => n > 0),
    [data.license_status],
  );

  const invoiceEntries = useMemo(
    () =>
      (
        [
          ['PAID', data.invoice_status.PAID],
          ['ISSUED', data.invoice_status.ISSUED],
          ['OVERDUE', data.invoice_status.OVERDUE],
          ['VOID', data.invoice_status.VOID],
        ] as const
      ).filter(([, n]) => n > 0),
    [data.invoice_status],
  );

  const planOptions = useMemo(
    () =>
      chartBase({
        chart: { type: 'bar' },
        plotOptions: { bar: { borderRadius: 6, columnWidth: '52%', distributed: true } },
        legend: { show: false },
        dataLabels: {
          enabled: true,
          formatter: (_val, opts) => String(planCounts[opts?.dataPointIndex ?? 0] ?? ''),
          style: { fontSize: '11px', fontFamily: 'inherit' },
        },
        xaxis: { categories: planLabels },
        yaxis: {
          labels: {
            formatter: (value) => formatCompactNumber(Number(value), loc),
          },
        },
        tooltip: {
          y: {
            formatter: (value) => formatMoney(Number(value), currency, loc),
          },
        },
      }),
    [currency, loc, planCounts, planLabels],
  );

  const tenantOptions = useMemo(
    () =>
      chartBase({
        chart: { type: 'bar' },
        plotOptions: { bar: { horizontal: true, borderRadius: 6, barHeight: '62%' } },
        legend: { show: false },
        xaxis: { categories: tenantLabels },
        tooltip: {
          y: {
            formatter: (value) => formatMoney(Number(value), currency, loc),
          },
        },
      }),
    [currency, loc, tenantLabels],
  );

  const licenseOptions = useMemo(
    () =>
      chartBase({
        colors: licenseEntries.map(([key]) => LICENSE_STATUS_COLORS[key]),
        labels: licenseEntries.map(([key]) => t(`licenseStatus.${key}`)),
        legend: { position: 'bottom' },
        plotOptions: { pie: { donut: { size: '62%' } } },
        dataLabels: { enabled: true },
        stroke: { width: 0 },
      }),
    [licenseEntries, t],
  );

  const invoiceOptions = useMemo(
    () =>
      chartBase({
        colors: invoiceEntries.map(([key]) => INVOICE_STATUS_COLORS[key]),
        labels: invoiceEntries.map(([key]) => t(`invoiceStatus.${key}`)),
        legend: { position: 'bottom' },
        plotOptions: { pie: { donut: { size: '62%' } } },
        dataLabels: { enabled: true },
        stroke: { width: 0 },
      }),
    [invoiceEntries, t],
  );

  const radialOptions = useMemo(
    () =>
      chartBase({
        colors: ['#0f766e'],
        labels: [t('dash.collectionRate')],
        plotOptions: {
          radialBar: {
            hollow: { size: '64%' },
            track: { background: '#f5f5f4' },
            dataLabels: {
              name: { fontSize: '12px', color: '#64748b', offsetY: 18 },
              value: {
                fontSize: '26px',
                fontWeight: 700,
                color: '#0f1c2e',
                offsetY: -12,
                formatter: (value) => `${Math.round(Number(value))}%`,
              },
            },
          },
        },
      }),
    [t],
  );

  return (
    <div className="flex min-h-full flex-1 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={t('dash.tenants')}
          value={String(k.tenants)}
          hint={t('dash.activeOf', { n: k.tenants_active })}
        />
        <Kpi
          label={t('dash.licensesActive')}
          value={String(k.licenses_active)}
          hint={t('dash.expiring', { n: k.expiring_soon })}
        />
        <Kpi
          label={t('dash.contracted')}
          value={formatCompactNumber(k.contracted, loc)}
          hint={formatMoney(k.contracted, currency, loc)}
        />
        <Kpi
          label={t('dash.collected')}
          value={formatCompactNumber(k.invoiced_collected, loc)}
          hint={t('dash.invoicesIssued', { n: k.invoices_issued })}
        />
        <Kpi
          label={t('dash.outstanding')}
          value={formatCompactNumber(k.invoiced_outstanding, loc)}
          hint={t('dash.expiredLicenses', { n: k.licenses_expired })}
        />
        <Kpi
          label={t('dash.collectionRate')}
          value={`${collectionPct}%`}
          hint={t('dash.suspendedOf', { n: k.tenants_suspended })}
        />
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-3 xl:grid-cols-12">
        <ChartPanel
          title={t('dash.byPlan')}
          empty={data.by_plan.length === 0}
          emptyLabel={t('dash.noChartData')}
          className="xl:col-span-6"
        >
          <ApexChart
            type="bar"
            series={[{ name: t('dash.contracted'), data: planValues }]}
            options={planOptions}
          />
        </ChartPanel>

        <ChartPanel
          title={t('dash.licenseMix')}
          empty={licenseEntries.length === 0}
          emptyLabel={t('dash.noChartData')}
          className="xl:col-span-3"
        >
          <ApexChart
            type="donut"
            series={licenseEntries.map(([, n]) => n)}
            options={licenseOptions}
          />
        </ChartPanel>

        <ChartPanel
          title={t('dash.collectionRate')}
          empty={billed === 0}
          emptyLabel={t('dash.noChartData')}
          className="xl:col-span-3"
        >
          <ApexChart type="radialBar" series={[collectionPct]} options={radialOptions} />
        </ChartPanel>

        <ChartPanel
          title={t('dash.topTenants')}
          empty={topTenants.length === 0}
          emptyLabel={t('dash.noChartData')}
          className="xl:col-span-6"
        >
          <ApexChart
            type="bar"
            series={[{ name: t('dash.contracted'), data: tenantValues }]}
            options={tenantOptions}
          />
        </ChartPanel>

        <ChartPanel
          title={t('dash.invoiceMix')}
          empty={invoiceEntries.length === 0}
          emptyLabel={t('dash.noChartData')}
          className="xl:col-span-3"
        >
          <ApexChart
            type="donut"
            series={invoiceEntries.map(([, n]) => n)}
            options={invoiceOptions}
          />
        </ChartPanel>

        <section className="flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-xl border border-stone-200 bg-white p-3 xl:col-span-3">
          <h2 className="shrink-0 text-sm font-semibold text-ink-900">
            {t('dash.recentInvoices')}
          </h2>
          <ul className="mt-2 min-h-0 flex-1 divide-y divide-stone-100 overflow-auto text-sm">
            {data.recent_invoices.length === 0 && (
              <li className="py-8 text-center text-slate-400">{t('invoices.emptyTitle')}</li>
            )}
            {data.recent_invoices.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to={`/invoices/${inv.id}`}
                    className="truncate font-medium text-brand-600 no-underline"
                  >
                    {inv.invoice_number}
                  </Link>
                  <span className="shrink-0 tabular-nums text-slate-700">
                    {formatCompactNumber(inv.total_amount, loc)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="truncate">{inv.tenant_name}</span>
                  <span>{t(`invoiceStatus.${inv.status}`)}</span>
                </div>
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
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xl font-bold tabular-nums leading-tight text-ink-900">
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-slate-400">{hint}</p>
    </div>
  );
}

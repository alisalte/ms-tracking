import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { type Invoice, listInvoices } from '@/api/billing';
import { apiMessage } from '@/api/client';
import { EmptyState } from '@/components/EmptyState';
import { formatMoney } from '@/lib/money';

export function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loc = i18n.language.startsWith('fa') ? 'fa-IR' : 'en-GB';

  useEffect(() => {
    void listInvoices()
      .then(setRows)
      .catch((err) => setError(apiMessage(err)));
  }, []);

  return (
    <div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rows.length === 0 && !error ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title={t('invoices.emptyTitle')}
          body={t('invoices.emptyBody')}
          action={
            <Link
              to="/tenants"
              className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white no-underline"
            >
              {t('invoices.goTenants')}
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-start text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('invoices.number')}</th>
                <th className="px-4 py-2.5 font-medium">{t('tenants.name')}</th>
                <th className="px-4 py-2.5 font-medium">{t('invoices.status')}</th>
                <th className="px-4 py-2.5 font-medium">{t('invoices.period')}</th>
                <th className="px-4 py-2.5 font-medium">{t('invoices.total')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-stone-100">
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/invoices/${r.id}`}
                      className="font-medium text-brand-600 no-underline"
                    >
                      {r.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{r.tenant_name ?? '—'}</td>
                  <td className="px-4 py-2.5">{t(`invoiceStatus.${r.status}`)}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {new Date(r.period_start).toLocaleDateString(loc)} –{' '}
                    {new Date(r.period_end).toLocaleDateString(loc)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {formatMoney(r.total_amount, r.currency, loc)}
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

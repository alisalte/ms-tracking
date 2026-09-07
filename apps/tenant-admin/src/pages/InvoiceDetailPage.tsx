import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { type Invoice, getInvoice, payInvoice, voidInvoice } from '@/api/billing';
import { apiMessage } from '@/api/client';
import { formatMoney } from '@/lib/money';

export function InvoiceDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loc = i18n.language.startsWith('fa') ? 'fa-IR' : 'en-GB';

  useEffect(() => {
    if (!id) return;
    void getInvoice(id)
      .then(setInvoice)
      .catch((err) => setError(apiMessage(err)));
  }, [id]);

  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  }
  if (!invoice) return <p className="text-slate-500">{t('common.loading')}</p>;

  const money = (n: number) => formatMoney(n, invoice.currency, loc);
  const canAct = invoice.status === 'ISSUED' || invoice.status === 'OVERDUE';

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to="/invoices" className="text-sm text-brand-600 no-underline">
          ← {t('common.back')}
        </Link>
        <div className="flex gap-2">
          {canAct && (
            <>
              <button
                type="button"
                disabled={busy}
                className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                onClick={() => {
                  setBusy(true);
                  void payInvoice(invoice.id)
                    .then(setInvoice)
                    .catch((err) => setError(apiMessage(err)))
                    .finally(() => setBusy(false));
                }}
              >
                {t('invoices.markPaid')}
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-xl border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-60"
                onClick={() => {
                  if (!window.confirm(t('invoices.confirmVoid'))) return;
                  setBusy(true);
                  void voidInvoice(invoice.id)
                    .then(setInvoice)
                    .catch((err) => setError(apiMessage(err)))
                    .finally(() => setBusy(false));
                }}
              >
                {t('invoices.void')}
              </button>
            </>
          )}
          <button
            type="button"
            className="rounded-xl bg-ink-900 px-3 py-1.5 text-sm font-semibold text-white"
            onClick={() => window.print()}
          >
            {t('invoices.print')}
          </button>
        </div>
      </div>

      <article className="print-sheet mx-auto max-w-3xl rounded-2xl border border-stone-200 bg-white p-8">
        <header className="flex items-start justify-between gap-4 border-b border-stone-200 pb-6">
          <div>
            <p className="text-xs font-semibold tracking-wide text-brand-600">{t('app.title')}</p>
            <h1 className="mt-1 text-2xl font-bold">{t('invoices.document')}</h1>
            <p className="mt-1 font-mono text-sm text-slate-500">{invoice.invoice_number}</p>
          </div>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold">
            {t(`invoiceStatus.${invoice.status}`)}
          </span>
        </header>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-slate-500">{t('tenants.name')}</dt>
            <dd className="mt-1 font-medium">{invoice.tenant_name ?? invoice.tenant_id}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('invoices.period')}</dt>
            <dd className="mt-1">
              {new Date(invoice.period_start).toLocaleDateString(loc)} –{' '}
              {new Date(invoice.period_end).toLocaleDateString(loc)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('invoices.issued')}</dt>
            <dd className="mt-1">{new Date(invoice.generated_at).toLocaleDateString(loc)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('invoices.due')}</dt>
            <dd className="mt-1">{new Date(invoice.due_date).toLocaleDateString(loc)}</dd>
          </div>
        </dl>
        <table className="mt-8 w-full text-sm">
          <thead className="border-b border-stone-200 text-start text-slate-500">
            <tr>
              <th className="py-2 font-medium">{t('invoices.item')}</th>
              <th className="py-2 font-medium">{t('invoices.qty')}</th>
              <th className="py-2 font-medium">{t('invoices.unit')}</th>
              <th className="py-2 font-medium">{t('invoices.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={`${line.type}-${i}`} className="border-b border-stone-100">
                <td className="py-2">{t(`lineType.${line.type}`)}</td>
                <td className="py-2 tabular-nums">{line.quantity}</td>
                <td className="py-2 tabular-nums">{money(line.unit_price)}</td>
                <td className="py-2 tabular-nums">{money(line.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 ms-auto max-w-xs text-sm">
          <div className="flex justify-between py-1">
            <span className="text-slate-500">{t('invoices.subtotal')}</span>
            <span className="tabular-nums">{money(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-500">{t('invoices.tax')}</span>
            <span className="tabular-nums">{money(invoice.tax_amount)}</span>
          </div>
          <div className="flex justify-between border-t border-stone-200 py-2 text-base font-bold">
            <span>{t('invoices.total')}</span>
            <span className="tabular-nums">{money(invoice.total_amount)}</span>
          </div>
        </div>
        {invoice.notes && <p className="mt-6 text-sm text-slate-500">{invoice.notes}</p>}
      </article>
    </div>
  );
}

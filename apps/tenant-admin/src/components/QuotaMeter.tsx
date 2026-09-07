import { useTranslation } from 'react-i18next';

import type { QuotaMeter } from '@/api/tenants';

export function QuotaMeterCard({
  title,
  meter,
  format = String,
}: {
  title: string;
  meter: QuotaMeter;
  format?: (n: number) => string;
}) {
  const { t } = useTranslation();
  const remaining = Math.max(0, meter.limit - meter.used);
  const tone =
    meter.state === 'exceeded'
      ? {
          wrap: 'border-red-200 bg-red-50/80',
          bar: 'bg-red-500',
          pct: 'text-red-700',
        }
      : meter.state === 'warn'
        ? {
            wrap: 'border-amber-200 bg-amber-50/70',
            bar: 'bg-amber-500',
            pct: 'text-amber-800',
          }
        : {
            wrap: 'border-stone-200 bg-white',
            bar: 'bg-brand-500',
            pct: 'text-ink-900',
          };

  return (
    <div className={`rounded-xl border p-3 ${tone.wrap}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-600">{title}</p>
        <p className={`text-lg font-bold tabular-nums leading-none ${tone.pct}`}>
          {Math.round(meter.pct)}%
        </p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-black/10">
        <div className={`h-full ${tone.bar}`} style={{ width: `${Math.min(100, meter.pct)}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-slate-600">
        <span>
          {format(meter.used)} / {format(meter.limit)}
        </span>
        <span className="text-slate-400">
          {t('meter.left')}: {format(remaining)}
        </span>
      </div>
    </div>
  );
}

export function MiniQuotaRow({
  label,
  meter,
}: {
  label: string;
  meter: QuotaMeter;
}) {
  const color =
    meter.state === 'exceeded'
      ? 'bg-red-500'
      : meter.state === 'warn'
        ? 'bg-amber-500'
        : 'bg-brand-500';
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-slate-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, meter.pct)}%` }} />
      </div>
      <span className="w-10 text-end text-[11px] tabular-nums text-slate-600">
        {Math.round(meter.pct)}%
      </span>
    </div>
  );
}

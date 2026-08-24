/**
 * ReportRangePicker — the TailAdmin shared time-range control for every
 * report (Sprint J §16, Phase 8 port): Today | Yesterday | Last 7 Days |
 * Last 30 Days | Custom (datetime-local from/to, converted to UTC ISO before
 * sending — the documented UTC strategy). Accessible: labeled inputs +
 * aria-pressed chips.
 */
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReportRange } from '@/api/report.api';
import { Button } from '@/components/tailwind-ui';

const PRESETS: Array<{ id: 'today' | 'yesterday' | '7d' | '30d' }> = [
  { id: 'today' },
  { id: 'yesterday' },
  { id: '7d' },
  { id: '30d' },
];

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReportRangePicker({
  range,
  onChange,
}: {
  range: ReportRange;
  onChange: (range: ReportRange) => void;
}) {
  const { t } = useTranslation();
  const isCustom = !range.preset;
  const [fromInput, setFromInput] = useState(range.from ? toLocalInput(range.from) : '');
  const [toInput, setToInput] = useState(range.to ? toLocalInput(range.to) : '');

  useEffect(() => {
    if (range.from) setFromInput(toLocalInput(range.from));
    if (range.to) setToInput(toLocalInput(range.to));
  }, [range.from, range.to]);

  const applyCustom = () => {
    const from = fromInput ? new Date(fromInput) : null;
    const to = toInput ? new Date(toInput) : null;
    if (!from || !to || from >= to) return; // invalid — keep last valid range
    onChange({ from: from.toISOString(), to: to.toISOString() });
  };

  const chip = (active: boolean) =>
    `h-7 cursor-pointer rounded-full border px-3 text-xs font-semibold transition-colors ${
      active
        ? 'border-brand-500 bg-brand-500 text-white'
        : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={chip(range.preset === p.id)}
          onClick={() => onChange({ preset: p.id })}
          aria-pressed={range.preset === p.id}
        >
          {t(`reports.range.${p.id}`)}
        </button>
      ))}
      <button
        type="button"
        className={chip(isCustom)}
        onClick={() =>
          onChange(
            isCustom
              ? { preset: '7d' }
              : {
                  from: new Date(Date.now() - 7 * 86_400_000).toISOString(),
                  to: new Date().toISOString(),
                },
          )
        }
        aria-pressed={isCustom}
        data-testid="report-range-custom"
      >
        {t('reports.range.custom')}
      </button>
      {isCustom && (
        <div className="flex items-center gap-1.5">
          <input
            type="datetime-local"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            aria-label={t('reports.range.from')}
            className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-[13px] text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
          />
          {/* Directional affordance — mirrors in RTL. */}
          <ArrowRight size={14} aria-hidden className="shrink-0 text-gray-400 rtl:rotate-180" />
          <input
            type="datetime-local"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            aria-label={t('reports.range.to')}
            className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-[13px] text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
          />
          <Button size="sm" onClick={applyCustom} data-testid="report-range-apply">
            {t('reports.range.apply')}
          </Button>
        </div>
      )}
    </div>
  );
}

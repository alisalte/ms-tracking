/**
 * ReportRangePicker — the TailAdmin shared time-range control for every
 * report (Sprint J §16, Phase 8 port): Today | Yesterday | Last 7 Days |
 * Last 30 Days | Custom (date + time from/to, converted to UTC ISO before
 * sending — the documented UTC strategy). A valid custom pair filters at once;
 * a reversed pair shows a message. Accessible: labeled inputs + aria-pressed chips.
 */
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReportRange } from '@/api/report.api';
import { Button, Input } from '@/components/tailwind-ui';

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

/** `[from, to)` of two datetime-local values, or null while they do not form a range. */
function parseCustom(fromValue: string, toValue: string): { from: Date; to: Date } | null {
  const from = fromValue ? new Date(fromValue) : null;
  const to = toValue ? new Date(toValue) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return from < to ? { from, to } : null;
}

/**
 * Picking another day starts it at `time` (00:00 for the start, 23:59 for the
 * end), so one day alone is a valid range. A pick on the same day is a time
 * change and is kept.
 */
function onNewDay(next: string, previous: string, time: string): string {
  if (!next || next.slice(0, 10) === previous.slice(0, 10)) return next;
  return `${next.slice(0, 10)}T${time}`;
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

  const reversed = Boolean(fromInput && toInput && !parseCustom(fromInput, toInput));

  // A valid pair filters the reports at once; an invalid one keeps the last
  // valid range and says why (the message below), instead of silently doing nothing.
  const commit = (fromValue: string, toValue: string) => {
    const next = parseCustom(fromValue, toValue);
    if (!next) return;
    const from = next.from.toISOString();
    const to = next.to.toISOString();
    if (from === range.from && to === range.to) return;
    onChange({ from, to });
  };

  const applyCustom = () => commit(fromInput, toInput);

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
          <Input
            type="datetime-local"
            value={fromInput}
            onChange={(e) => {
              const next = onNewDay(e.target.value, fromInput, '00:00');
              setFromInput(next);
              commit(next, toInput);
            }}
            aria-label={t('reports.range.from')}
            wrapperClassName="w-auto"
            className="h-8 px-2 text-[13px]"
          />
          {/* Directional affordance — mirrors in RTL. */}
          <ArrowRight size={14} aria-hidden className="shrink-0 text-gray-400 rtl:rotate-180" />
          <Input
            type="datetime-local"
            value={toInput}
            onChange={(e) => {
              const next = onNewDay(e.target.value, toInput, '23:59');
              setToInput(next);
              commit(fromInput, next);
            }}
            aria-label={t('reports.range.to')}
            wrapperClassName="w-auto"
            className="h-8 px-2 text-[13px]"
          />
          <Button size="sm" onClick={applyCustom} data-testid="report-range-apply">
            {t('reports.range.apply')}
          </Button>
        </div>
      )}
      {isCustom && reversed && (
        <p role="alert" className="w-full text-xs text-danger-600 dark:text-danger-400">
          {t('reports.range.invalid')}
        </p>
      )}
    </div>
  );
}

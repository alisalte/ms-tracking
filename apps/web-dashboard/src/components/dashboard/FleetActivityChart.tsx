import type { EChartsOption } from 'echarts';
import { Activity } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFleetActivity } from '@/api/fleet.api';
import { status } from '@/theme/palette';

import { EChart } from './EChart';
import { WidgetCard } from './WidgetCard';

/** Time-range selector options (UI_UX_Design.md §1.5). */
const RANGES = ['today', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];

/** Localized hour formatter for the x-axis. */
function formatHour(h: number) {
  return `${String(h).padStart(2, '0')}:00`;
}

/** Gradient stops definition keyed by series key (avoids id clashes). */
const SERIES = [
  { key: 'driving', color: status.green, labelKey: 'dashboard.states.driving' },
  { key: 'idle', color: status.amber, labelKey: 'dashboard.states.idle' },
  { key: 'stopped', color: status.slate, labelKey: 'dashboard.states.stopped' },
] as const;

/**
 * FleetActivityChart — 24h stacked-area chart of fleet activity (ECharts).
 *
 * UI_UX_Design.md §1.4: driving / idle / stopped stacked areas with a rich
 * crosshair tooltip, a Today / 7d / 30d selector in the header, and a legend
 * that doubles as a category key. Colors come from the semantic status tokens
 * — green for driving (active), amber for idle, slate for stopped — so the
 * chart shares meaning with the rest of the dashboard.
 *
 * Tailwind shell; ECharts option + `useFleetActivity(range)` hook unchanged.
 */
export function FleetActivityChart() {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('today');
  const { data, isLoading } = useFleetActivity(range);

  const option = useMemo(() => {
    if (!data) return null;
    const hours = data.map((b) => b.hour);
    return {
      legend: { show: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: { formatter: (p: { value: number }) => formatHour(Number(p.value)) },
        },
      },
      grid: { left: 8, right: 16, top: 16, bottom: 28, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: hours,
        axisLabel: {
          formatter: (h: string) => formatHour(Number(h)),
          interval: 3,
          hideOverlap: true,
        },
      },
      yAxis: { type: 'value', minInterval: 1 },
      series: SERIES.map((s, idx) => ({
        name: t(s.labelKey),
        type: 'line',
        stack: 'activity',
        smooth: true,
        symbol: 'circle',
        symbolSize: 0,
        showSymbol: false,
        emphasis: { focus: 'series' },
        lineStyle: { width: 1.5 },
        // Stacked area: only the top stack should be filled to its boundary;
        // ECharts fills the cumulative stack area, so a translucent gradient
        // per series reads cleanly.
        areaStyle: {
          opacity: 0.45,
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${s.color}99` },
              { offset: 1, color: `${s.color}14` },
            ],
          },
        },
        itemStyle: { color: s.color },
        // ensure stack order: driving bottom, stopped top
        z: SERIES.length - idx,
        data: data.map((b) => (b as unknown as Record<string, number>)[s.key]),
      })),
    } as EChartsOption;
  }, [data, t]);

  return (
    <WidgetCard
      titleKey="dashboard.widgets.activity"
      icon={Activity}
      live={range === 'today'}
      loading={isLoading}
      action={
        <fieldset
          aria-label={t('dashboard.widgets.activityRange')}
          className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-white/10 dark:bg-white/5"
        >
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={[
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === r
                  ? 'bg-white text-brand-700 shadow-sm dark:bg-graydark-400 dark:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-graydark-600 dark:hover:text-white',
              ].join(' ')}
            >
              {t(`dashboard.range.${r}`)}
            </button>
          ))}
        </fieldset>
      }
    >
      <div className="h-[260px] w-full">
        {isLoading || !option ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-gray-100 dark:bg-white/5" />
        ) : (
          <EChart option={option} height={260} />
        )}
      </div>

      {/* Legend doubles as a filter (§1.4) — color + label, no interactivity yet. */}
      <div className="mt-2 flex flex-wrap gap-4">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-xs text-gray-500 dark:text-graydark-600">{t(s.labelKey)}</span>
          </span>
        ))}
      </div>
    </WidgetCard>
  );
}

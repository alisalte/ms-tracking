import type { EChartsOption } from 'echarts';
import { Clock } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTrips } from '@/api/report.api';
import { status } from '@/theme/palette';

import { DashboardCard } from './DashboardCard';
import { EChart } from './EChart';

/** Today only — the "rush hours" panel is intrinsically a single-day view. */
const RANGE = { preset: 'today' } as const;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * The VIEWER's local UTC offset (minutes, as getTimezoneOffset() returns it
 * with the opposite sign) — hour buckets match the clock the operator sees,
 * whatever their timezone (was hardcoded to Tehran's +3:30).
 */
const TZ_OFFSET_MIN = -new Date().getTimezoneOffset();

/**
 * HourlyActivityChart — trip starts per local hour (today).
 *
 * Buckets the reporting service's trip rows (`GET /reports/trips`, preset 1d)
 * by their start hour in the fleet's local timezone, as a soft-gradient area
 * bar — the day's dispatch peaks (morning departures, afternoon returns) at a
 * glance. The peak hour is highlighted.
 */
export function HourlyActivityChart() {
  const { t } = useTranslation();
  const trips = useTrips(RANGE);
  const rows = trips.data?.items ?? [];

  const { counts, peak } = useMemo(() => {
    const c = new Array<number>(24).fill(0);
    for (const trip of rows) {
      const ts = new Date(trip.startedAt).getTime();
      if (Number.isNaN(ts)) continue;
      const localHour = new Date(ts + TZ_OFFSET_MIN * 60_000).getUTCHours();
      c[localHour] += 1;
    }
    let peakHour = -1;
    let peakCount = 0;
    for (let i = 0; i < 24; i++) {
      if (c[i] > peakCount) {
        peakCount = c[i];
        peakHour = i;
      }
    }
    return { counts: c, peak: peakHour };
  }, [rows]);

  const empty = !trips.isLoading && !trips.isError && rows.length === 0;

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const point = Array.isArray(p) ? p[0] : p;
          const h = Number(point.name);
          return `<b>${String(h).padStart(2, '0')}:00 – ${String((h + 1) % 24).padStart(2, '0')}:00</b><br/>${t(
            'dashboard.charts.tripStarts',
          )}: <b>${point.value}</b>`;
        },
      },
      grid: { left: 8, right: 12, top: 22, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: HOURS.map((h) => String(h)),
        axisLabel: { interval: 2, formatter: (v: string) => `${v.padStart(2, '0')}` },
      },
      yAxis: { type: 'value', minInterval: 1, splitNumber: 3 },
      series: [
        {
          name: t('dashboard.charts.tripStarts'),
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: {
            borderRadius: [3, 3, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: status.teal },
                { offset: 1, color: 'rgba(6, 182, 212, 0.25)' },
              ],
            },
          },
          markPoint:
            peak >= 0 && counts[peak] > 0
              ? {
                  symbolSize: 44,
                  itemStyle: { color: status.warning },
                  label: { fontSize: 10, fontWeight: 800, color: '#fff' },
                  data: [
                    {
                      coord: [String(peak), counts[peak]],
                      value: counts[peak],
                      name: t('dashboard.charts.peak'),
                    },
                  ],
                }
              : undefined,
          data: counts,
        },
      ],
    }),
    [counts, peak, t],
  );

  return (
    <DashboardCard
      titleKey="dashboard.widgets.hourlyActivity"
      icon={Clock}
      accent="teal"
      loading={trips.isLoading && !trips.isError}
      empty={empty}
      emptyKey="reports.charts.empty"
      error={trips.isError ? trips.error : undefined}
      onRetry={() => void trips.refetch()}
      flush
    >
      <div className="w-full px-4 pb-3 sm:px-5">
        <EChart option={option} height={230} />
        {peak >= 0 && counts[peak] > 0 && (
          <p className="-mt-1 pb-1 text-center text-[0.7rem] font-semibold text-gray-500 dark:text-graydark-600">
            {t('dashboard.charts.peakHour', {
              hour: String(peak).padStart(2, '0'),
              count: counts[peak],
            })}
          </p>
        )}
      </div>
    </DashboardCard>
  );
}

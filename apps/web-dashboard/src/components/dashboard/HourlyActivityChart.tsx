import type { ApexOptions } from 'apexcharts';
import { Clock } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTrips } from '@/api/report.api';
import { chart } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

/** Today only — the "rush hours" panel is intrinsically a single-day view. */
const RANGE = { preset: 'today' } as const;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * The VIEWER's local UTC offset (minutes, as getTimezoneOffset() returns it
 * with the opposite sign) — hour buckets match the clock the operator sees.
 */
const TZ_OFFSET_MIN = -new Date().getTimezoneOffset();

/**
 * HourlyActivityChart — trip starts per local hour (today).
 *
 * Buckets reporting-service trip rows by start hour in the operator's local
 * timezone as a soft column chart — dispatch peaks at a glance.
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

  const options = useMemo<ApexOptions>(
    () => ({
      colors: [chart.distance],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'vertical',
          shadeIntensity: 0.35,
          opacityFrom: 1,
          opacityTo: 0.65,
          stops: [0, 100],
        },
      },
      plotOptions: {
        bar: {
          columnWidth: '52%',
          borderRadius: 6,
          colors: {
            ranges:
              peak >= 0
                ? [{ from: counts[peak], to: counts[peak], color: chart.peak }]
                : [],
          },
        },
      },
      xaxis: {
        categories: HOURS.map((h) => String(h).padStart(2, '0')),
        tickAmount: 8,
      },
      yaxis: { decimalsInFloat: 0, min: 0, forceNiceScale: true },
      tooltip: {
        y: {
          formatter: (v: number) => `${v}`,
          title: { formatter: () => t('dashboard.charts.tripStarts') },
        },
      },
    }),
    [counts, peak, t],
  );

  const series = useMemo(
    () => [{ name: t('dashboard.charts.tripStarts'), data: counts }],
    [counts, t],
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
        <ApexChart type="bar" series={series} options={options} height={230} />
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

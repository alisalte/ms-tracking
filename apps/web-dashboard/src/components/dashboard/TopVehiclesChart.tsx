import type { ApexOptions } from 'apexcharts';
import { Truck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDistance } from '@/api/report.api';
import { status } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

/** How many vehicles make the "top" list. */
const TOP_N = 8;
const RANGE = { preset: '7d' } as const;

/**
 * TopVehiclesChart — horizontal distance leaderboard (last 7 days).
 *
 * Sorts `GET /reports/distance` descending and renders the top N as bars.
 */
export function TopVehiclesChart() {
  const { t } = useTranslation();
  const distance = useDistance(RANGE);
  const rows = useMemo(
    () =>
      [...(distance.data?.items ?? [])]
        .sort((a, b) => b.distanceKm - a.distanceKm)
        .filter((r) => r.distanceKm > 0)
        .slice(0, TOP_N),
    [distance.data],
  );
  const empty = !distance.isLoading && !distance.isError && rows.length === 0;

  const series = useMemo(
    () => [
      {
        name: t('dashboard.charts.distance'),
        data: rows.map((r) => Number(r.distanceKm.toFixed(1))),
      },
    ],
    [rows, t],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      colors: [status.blue],
      plotOptions: {
        bar: {
          horizontal: true,
          barHeight: '58%',
          borderRadius: 3,
          dataLabels: { position: 'top' },
        },
      },
      dataLabels: {
        enabled: true,
        formatter: (v: number) => `${Number(v).toLocaleString()}`,
        offsetX: 18,
        style: { fontSize: '10px', fontWeight: 600 },
      },
      xaxis: {
        categories: rows.map((r) => r.label),
        title: { text: 'km' },
      },
      yaxis: { labels: { maxWidth: 96 } },
      tooltip: {
        y: { formatter: (v: number) => `${Number(v).toLocaleString()} km` },
      },
    }),
    [rows],
  );

  return (
    <DashboardCard
      titleKey="dashboard.widgets.topVehicles"
      icon={Truck}
      loading={distance.isLoading && !distance.isError}
      empty={empty}
      emptyKey="reports.charts.empty"
      error={distance.isError ? distance.error : undefined}
      onRetry={() => void distance.refetch()}
      flush
    >
      <div className="w-full px-4 pb-3 sm:px-5">
        <ApexChart
          type="bar"
          series={series}
          options={options}
          height={Math.max(200, rows.length * 34 + 40)}
        />
      </div>
    </DashboardCard>
  );
}

import type { ApexOptions } from 'apexcharts';
import { Gauge } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type SpeedRowWire, useSpeed } from '@/api/report.api';
import { status } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

/** How many vehicles make the speed leaderboard. */
const TOP_N = 8;
const RANGE = { preset: '7d' } as const;

/** Heat ramp for the bars: faster = hotter. */
function speedColor(maxSpeedKph: number): string {
  if (maxSpeedKph >= 110) return status.danger;
  if (maxSpeedKph >= 95) return status.warning;
  return status.info;
}

/**
 * SpeedLeadersChart — fastest vehicles of the period (last 7 days).
 *
 * From `GET /reports/speed`: top N by max speed as horizontal bars.
 */
export function SpeedLeadersChart() {
  const { t } = useTranslation();
  const speed = useSpeed(RANGE);

  const rows = useMemo(
    () =>
      [...(speed.data?.items ?? [])]
        .filter((r) => r.maxSpeedKph !== null && r.maxSpeedKph > 0)
        .sort((a, b) => (b.maxSpeedKph ?? 0) - (a.maxSpeedKph ?? 0))
        .slice(0, TOP_N),
    [speed.data],
  );
  const empty = !speed.isLoading && !speed.isError && rows.length === 0;

  const series = useMemo(
    () => [
      {
        name: t('dashboard.charts.maxSpeed'),
        data: rows.map((r) => Math.round(r.maxSpeedKph ?? 0)),
      },
    ],
    [rows, t],
  );

  const options = useMemo<ApexOptions>(() => {
    const colors = rows.map((r) => speedColor(r.maxSpeedKph ?? 0));
    return {
      chart: { type: 'bar' },
      colors,
      plotOptions: {
        bar: {
          horizontal: true,
          distributed: true,
          barHeight: '58%',
          borderRadius: 4,
          dataLabels: { position: 'top' },
        },
      },
      legend: { show: false },
      dataLabels: {
        enabled: true,
        formatter: (v: number) => `${Math.round(v)}`,
        offsetX: 18,
        style: { fontSize: '10px', fontWeight: 700, colors: undefined },
      },
      xaxis: {
        categories: rows.map((r) => r.label),
        title: { text: 'km/h' },
      },
      yaxis: { labels: { maxWidth: 96 } },
      tooltip: {
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const row: SpeedRowWire | undefined = rows[dataPointIndex];
          if (!row) return '';
          const avg = row.avgSpeedKph !== null ? Math.round(row.avgSpeedKph) : '—';
          return `<div class="px-3 py-2 text-xs">
            <div class="font-bold mb-1">${row.label}</div>
            <div>${t('dashboard.charts.maxSpeed')}: <b>${Math.round(row.maxSpeedKph ?? 0)}</b> km/h</div>
            <div>${t('dashboard.charts.avgSpeed')}: ${avg} km/h</div>
            <div>${t('dashboard.charts.speedingAlarms')}: <b>${row.speedingAlarms}</b></div>
          </div>`;
        },
      },
    };
  }, [rows, t]);

  return (
    <DashboardCard
      titleKey="dashboard.widgets.speedLeaders"
      icon={Gauge}
      accent="danger"
      loading={speed.isLoading && !speed.isError}
      empty={empty}
      emptyKey="reports.charts.empty"
      error={speed.isError ? speed.error : undefined}
      onRetry={() => void speed.refetch()}
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

import type { EChartsOption } from 'echarts';
import { Truck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDistance } from '@/api/report.api';
import { status } from '@/theme/palette';

import { DashboardCard } from './DashboardCard';
import { EChart } from './EChart';

/** How many vehicles make the "top" list. */
const TOP_N = 8;
const RANGE = { preset: '7d' } as const;

/**
 * TopVehiclesChart — horizontal distance leaderboard (last 7 days).
 *
 * Sorts the reporting service's per-vehicle distance rows
 * (`GET /reports/distance`) descending and renders the top N as horizontal
 * bars — the heaviest movers at a glance. Rendered only for users holding
 * `report.read` (gated by FleetDashboard).
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

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => `${Number(v).toLocaleString()} km`,
      },
      grid: { left: 8, right: 32, top: 8, bottom: 0, containLabel: true },
      xAxis: { type: 'value', name: 'km', splitNumber: 4 },
      yAxis: {
        type: 'category',
        // ECharts draws category axes bottom-up — reverse so #1 sits on top.
        data: rows.map((r) => r.label).reverse(),
        axisLabel: { width: 96, overflow: 'truncate' },
      },
      series: [
        {
          name: t('dashboard.charts.distance'),
          type: 'bar',
          barMaxWidth: 16,
          itemStyle: { color: status.blue, borderRadius: [0, 3, 3, 0] },
          label: {
            show: true,
            position: 'right',
            formatter: (p) => `${Number(p.value).toLocaleString()}`,
            textStyle: { fontSize: 10 },
          },
          data: rows.map((r) => Number(r.distanceKm.toFixed(1))).reverse(),
        },
      ],
    }),
    [rows, t],
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
      <div className="w-full px-4 pb-3">
        <EChart option={option} height={Math.max(200, rows.length * 34 + 40)} />
      </div>
    </DashboardCard>
  );
}

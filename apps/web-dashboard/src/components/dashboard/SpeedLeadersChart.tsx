import type { EChartsOption } from 'echarts';
import { Gauge } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type SpeedRowWire, useSpeed } from '@/api/report.api';
import { status } from '@/theme/palette';

import { DashboardCard } from './DashboardCard';
import { EChart } from './EChart';

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
 * From the reporting service's per-vehicle speed rows (`GET /reports/speed`):
 * top N by max speed as horizontal bars (heat-ramped by speed), with the
 * vehicle's average speed and speeding-alarm count surfaced in the tooltip —
 * the fleet's aggressive drivers at a glance.
 */
export function SpeedLeadersChart() {
  const { t } = useTranslation();
  const speed = useSpeed(RANGE);

  // ECharts draws category axes bottom-up — reverse so #1 sits on top.
  const rows = useMemo(
    () =>
      [...(speed.data?.items ?? [])]
        .filter((r) => r.maxSpeedKph !== null && r.maxSpeedKph > 0)
        .sort((a, b) => (b.maxSpeedKph ?? 0) - (a.maxSpeedKph ?? 0))
        .slice(0, TOP_N)
        .reverse(),
    [speed.data],
  );
  const empty = !speed.isLoading && !speed.isError && rows.length === 0;

  const option = useMemo<EChartsOption>(() => {
    const tooltipFormatter = (params: unknown): string => {
      const point = Array.isArray(params) ? params[0] : params;
      const dataIndex = Number((point as { dataIndex?: number }).dataIndex ?? 0);
      const row: SpeedRowWire | undefined = rows[dataIndex];
      if (!row) return '';
      const avg = row.avgSpeedKph !== null ? Math.round(row.avgSpeedKph) : '—';
      const lines = [
        `<b>${row.label}</b>`,
        `${t('dashboard.charts.maxSpeed')}: <b>${Math.round(row.maxSpeedKph ?? 0)}</b> km/h`,
        `${t('dashboard.charts.avgSpeed')}: ${avg} km/h`,
        `${t('dashboard.charts.speedingAlarms')}: <b>${row.speedingAlarms}</b>`,
      ];
      return lines.join('<br/>');
    };
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: tooltipFormatter,
      },
      grid: { left: 8, right: 42, top: 8, bottom: 0, containLabel: true },
      xAxis: { type: 'value', name: 'km/h', splitNumber: 4 },
      yAxis: {
        type: 'category',
        data: rows.map((r) => r.label),
        axisLabel: { width: 96, overflow: 'truncate' },
      },
      series: [
        {
          name: t('dashboard.charts.maxSpeed'),
          type: 'bar',
          barMaxWidth: 16,
          itemStyle: {
            borderRadius: [0, 4, 4, 0] as [number, number, number, number],
            color: (p: { dataIndex: number }) => speedColor(rows[p.dataIndex]?.maxSpeedKph ?? 0),
          },
          label: {
            show: true,
            position: 'right',
            formatter: (p: { value: number }) => `${Math.round(p.value)}`,
            textStyle: { fontSize: 10, fontWeight: 700 },
          },
          data: rows.map((r) => Math.round(r.maxSpeedKph ?? 0)),
        },
      ] as EChartsOption['series'],
    } as EChartsOption;
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
        <EChart option={option} height={Math.max(200, rows.length * 34 + 40)} />
      </div>
    </DashboardCard>
  );
}

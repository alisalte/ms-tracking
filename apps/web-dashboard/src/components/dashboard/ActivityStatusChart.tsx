import type { EChartsOption } from 'echarts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { mapAccents, neutral, status } from '@/theme/palette';
import type { MapVehicle } from '@/types/fleet.types';
import { DashboardCard } from './DashboardCard';
import { EChart } from './EChart';

/** Movement state → (i18n label key, semantic palette color). Labels pair with
 *  colors — the legend never relies on color alone (§0.7). */
const STATES: Array<{ state: keyof StateCounts; key: string; color: string }> = [
  { state: 'driving', key: 'dashboard.states.driving', color: status.success },
  { state: 'idle', key: 'dashboard.states.idle', color: status.warning },
  { state: 'stopped', key: 'dashboard.states.stopped', color: mapAccents.vehicleOffline },
  { state: 'offline', key: 'dashboard.states.offline', color: neutral[600] },
];

export interface StateCounts {
  driving: number;
  idle: number;
  stopped: number;
  offline: number;
}

/**
 * Count vehicles per movement state (shared with the KPI row). MapVehicle's
 * type union also admits 'overspeed' (a driving sub-state in the fixtures) —
 * bucketed under driving: a speeding vehicle is moving.
 */
export function countStates(vehicles: readonly MapVehicle[]): StateCounts {
  const counts: StateCounts = { driving: 0, idle: 0, stopped: 0, offline: 0 };
  for (const v of vehicles) {
    if (v.state === 'idle') counts.idle += 1;
    else if (v.state === 'stopped') counts.stopped += 1;
    else if (v.state === 'offline') counts.offline += 1;
    else counts.driving += 1; // driving | overspeed
  }
  return counts;
}

/**
 * ActivityStatusChart — live distribution of fleet movement states (Phase 4).
 *
 * A donut over the SAME real join the live map uses (registry × status ×
 * position via useMapVehicles) — driving / idle / stopped / offline, with the
 * fleet total in the center. No 24h backend series exists, so this is the
 * honest "activity" view rather than a fabricated timeline.
 */
export function ActivityStatusChart({
  counts,
  loading,
  error,
  onRetry,
}: {
  counts: StateCounts;
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();

  const option = useMemo(() => {
    const total = counts.driving + counts.idle + counts.stopped + counts.offline;
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}: ${p.value} (${p.percent}%)`,
      },
      legend: {
        orient: 'vertical',
        right: 0,
        top: 'center',
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { fontSize: 11 },
      },
      title: {
        text: total.toLocaleString(),
        subtext: t('dashboard.stats.totalVehicles'),
        left: '30%',
        top: 'center',
        textStyle: { fontSize: 22, fontWeight: 700 },
        subtextStyle: { fontSize: 10 },
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '80%'],
          center: ['30%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 5, borderColor: 'transparent', borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: true, scaleSize: 5 },
          data: STATES.map((s) => ({
            name: t(s.key),
            value: counts[s.state],
            itemStyle: { color: s.color },
          })),
        },
      ],
    } as EChartsOption;
  }, [counts, t]);

  return (
    <DashboardCard
      titleKey="dashboard.sections.activity"
      accent="success"
      icon={PieChartIcon}
      loading={loading}
      empty={!loading && counts.driving + counts.idle + counts.stopped + counts.offline === 0}
      emptyKey="dashboard.empty.alerts"
      error={error}
      onRetry={onRetry}
      flush
    >
      <div className="w-full px-4 pb-3 sm:px-5">
        <EChart option={option} height={220} />
      </div>
    </DashboardCard>
  );
}

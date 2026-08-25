import type { ApexOptions } from 'apexcharts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { mapAccents, neutral, status } from '@/theme/palette';
import type { MapVehicle } from '@/types/fleet.types';
import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

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
 * ActivityStatusChart — live distribution of fleet movement states.
 *
 * Donut over the SAME real join the live map uses (registry × status ×
 * position via useMapVehicles) — driving / idle / stopped / offline.
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

  const labels = useMemo(() => STATES.map((s) => t(s.key)), [t]);
  const series = useMemo(() => STATES.map((s) => counts[s.state]), [counts]);
  const colors = useMemo(() => STATES.map((s) => s.color), []);

  const options = useMemo<ApexOptions>(
    () => ({
      labels,
      colors,
      legend: { position: 'right', offsetY: 20 },
      plotOptions: {
        pie: {
          donut: {
            size: '72%',
            labels: {
              show: true,
              total: {
                show: true,
                label: t('dashboard.stats.totalVehicles'),
                formatter: () => series.reduce((a, b) => a + b, 0).toLocaleString(),
              },
            },
          },
        },
      },
      stroke: { width: 2, colors: ['transparent'] },
    }),
    [labels, colors, series, t],
  );

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
        <ApexChart type="donut" series={series} options={options} height={220} />
      </div>
    </DashboardCard>
  );
}

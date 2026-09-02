import type { ApexOptions } from 'apexcharts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveAlarms } from '@/api/fleet.api';
import { chart } from '@/theme/palette';
import type { AlertType } from '@/types/fleet.types';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

/** Alert type → semantic color (§0.2). */
const TYPE_COLOR: Record<AlertType, string> = {
  overspeed: chart.speeding,
  fcw: chart.fcw,
  idle: chart.idle,
  geofence: chart.geofence,
  dtc: chart.dtc,
  lowBattery: chart.lowBattery,
};

/** Display order for the rose/donut — most-severe first. */
const TYPE_ORDER: AlertType[] = ['overspeed', 'fcw', 'idle', 'geofence', 'dtc', 'lowBattery'];

/**
 * AlertTypeBreakdownChart — polar-area of active alerts grouped by type.
 *
 * Counts the REAL active-alarm feed (notification-service) by category.
 */
export function AlertTypeBreakdownChart() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useActiveAlarms();
  const alerts = data ?? [];

  const { labels, series, colors } = useMemo(() => {
    const counts = new Map<AlertType, number>();
    for (const a of alerts) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    const ordered = TYPE_ORDER.filter((type) => counts.has(type));
    return {
      labels: ordered.map((type) => t(`dashboard.alerts.${type}`)),
      series: ordered.map((type) => counts.get(type) ?? 0),
      colors: ordered.map((type) => TYPE_COLOR[type]),
    };
  }, [alerts, t]);

  const options = useMemo<ApexOptions>(
    () => ({
      labels,
      colors,
      legend: { position: 'right', offsetY: 12 },
      fill: { opacity: 0.82 },
      plotOptions: {
        polarArea: {
          rings: { strokeWidth: 0 },
          spokes: { strokeWidth: 0 },
        },
      },
    }),
    [labels, colors],
  );

  return (
    <DashboardCard
      titleKey="dashboard.widgets.alertTypes"
      accent="info"
      icon={PieChartIcon}
      loading={isLoading && !isError}
      empty={alerts.length === 0 && !isLoading && !isError}
      emptyKey="dashboard.empty.alerts"
      error={isError ? error : undefined}
      onRetry={() => void refetch()}
      flush
    >
      <div className="w-full px-4 pb-3 sm:px-5">
        <ApexChart type="polarArea" series={series} options={options} height={220} />
      </div>
    </DashboardCard>
  );
}

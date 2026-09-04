import type { ApexOptions } from 'apexcharts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveAlarms } from '@/api/fleet.api';
import { ALARM_CATALOG_TYPES, localizeAlarmType, mapAlarmType } from '@/lib/alarm-copy';
import { chart } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

/** Alert type → semantic color (§0.2). */
const TYPE_COLOR: Record<string, string> = {
  overspeed: chart.speeding,
  dms: chart.fcw,
  fcw: chart.fcw,
  idle: chart.idle,
  geofence: chart.geofence,
  dtc: chart.dtc,
  battery: chart.lowBattery,
  lowBattery: chart.lowBattery,
  sos: chart.critical,
  collision: chart.speeding,
  offline: chart.offline,
  camera: chart.other,
  'fuel-theft': chart.high,
  temperature: chart.medium,
  ignition: chart.info,
  tow: chart.other,
  power: chart.high,
  jamming: chart.other,
  other: chart.other,
};

const TYPE_ORDER = [...ALARM_CATALOG_TYPES, 'fcw', 'dtc', 'lowBattery'] as const;

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
    const counts = new Map<string, number>();
    for (const a of alerts) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    const extra = [...counts.keys()].filter((type) => !TYPE_ORDER.includes(type as never));
    const ordered = [...TYPE_ORDER.filter((type) => counts.has(type)), ...extra];
    return {
      labels: ordered.map((type) => localizeAlarmType(t, mapAlarmType(type))),
      series: ordered.map((type) => counts.get(type) ?? 0),
      colors: ordered.map((type) => TYPE_COLOR[type] ?? chart.other),
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

import {
  Activity,
  Cpu,
  Gauge,
  History,
  MapPin,
  Radio,
  TrendingUp,
  Truck,
  Wifi,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveAlarms, useDeviceStatuses, useFleetStats, useMapVehicles } from '@/api/fleet.api';
import { PERMISSIONS, PermissionGate, usePermissions } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/tailwind-ui';

import { ActivityStatusChart, countStates } from './ActivityStatusChart';
import { AlarmSeverityChart } from './AlarmSeverityChart';
import { AlarmStatusChart } from './AlarmStatusChart';
import { AlertTypeBreakdownChart } from './AlertTypeBreakdownChart';
import { DistanceTrendChart } from './DistanceTrendChart';
import { DurationMixChart } from './DurationMixChart';
import { FleetComparisonChart } from './FleetComparisonChart';
import { FleetHealthPanel } from './FleetHealthPanel';
import { FleetMapPreviewCard } from './FleetMapPreviewCard';
import { HourlyActivityChart } from './HourlyActivityChart';
import { KpiChip, KpiTile } from './KpiTile';
import { MaintenanceStatusCard } from './MaintenanceStatusCard';
import { RecentEventsPanel } from './RecentEventsPanel';
import { ReportsKpiRow } from './ReportsKpiRow';
import { SpeedLeadersChart } from './SpeedLeadersChart';
import { TopVehiclesChart } from './TopVehiclesChart';
import { TrendChartsRow } from './TrendChartsRow';
import { WelcomeBanner } from './WelcomeBanner';

/**
 * FleetDashboard — FleetVision operations home.
 *
 * UI-only redesign of the previous console: same queries, permissions, and
 * honest loading/empty/error states. Extra reporting widgets stay below the
 * primary layout so no existing functionality is dropped.
 */
export function FleetDashboard() {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const canReadReports = can(PERMISSIONS.reportRead);
  const stats = useFleetStats();
  const mapVehicles = useMapVehicles();
  const alarms = useActiveAlarms();
  const deviceStatuses = useDeviceStatuses();

  const vehicles = mapVehicles.data ?? [];
  const counts = useMemo(() => countStates(vehicles), [vehicles]);
  const devices = deviceStatuses.data ?? [];
  const activeAlarms = alarms.data?.length ?? 0;
  const activeDevices = useMemo(
    () => devices.filter((d) => d.state === 'ONLINE').length,
    [devices],
  );
  const connectionPct =
    stats.data && stats.data.totalVehicles > 0
      ? Math.round((stats.data.online / stats.data.totalVehicles) * 100)
      : null;
  const movingPct =
    counts.driving + counts.idle > 0
      ? Math.round((counts.driving / (counts.driving + counts.idle)) * 100)
      : null;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 overflow-x-hidden">
      <WelcomeBanner />

      <section aria-labelledby="dash-live-heading" className="flex flex-col gap-3">
        <SectionLabel
          id="dash-live-heading"
          icon={Radio}
          title={t('dashboard.sectionLabels.live')}
          hint={t('dashboard.sectionLabels.liveHint')}
        />
        {stats.isError ? (
          <Card flush className="p-2">
            <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <KpiTile
              labelKey="dashboard.stats.totalVehicles"
              value={stats.data?.totalVehicles}
              icon={Truck}
              tone="brand"
              loading={stats.isLoading}
              footer={
                stats.data && (
                  <KpiChip tone="gray">
                    {t('dashboard.stats.fleets')}: {stats.data.totalFleets}
                  </KpiChip>
                )
              }
            />
            <KpiTile
              labelKey="dashboard.stats.moving"
              value={counts.driving}
              icon={Gauge}
              tone="success"
              loading={mapVehicles.isLoading}
              footer={
                movingPct !== null && (
                  <KpiChip tone="success">
                    {movingPct}% {t('dashboard.ofActive')}
                  </KpiChip>
                )
              }
            />
            <KpiTile
              labelKey="dashboard.stats.idle"
              value={counts.idle}
              icon={Activity}
              tone="warning"
              loading={mapVehicles.isLoading}
            />
            <KpiTile
              labelKey="dashboard.stats.parked"
              value={counts.stopped}
              icon={MapPin}
              tone="gray"
              loading={mapVehicles.isLoading}
            />
            <KpiTile
              labelKey="dashboard.stats.onlineConnections"
              value={stats.data?.online}
              icon={Wifi}
              tone="success"
              loading={stats.isLoading}
              footer={
                connectionPct !== null && (
                  <KpiChip
                    tone={
                      connectionPct >= 80 ? 'success' : connectionPct >= 50 ? 'warning' : 'danger'
                    }
                  >
                    {connectionPct}%
                  </KpiChip>
                )
              }
            />
            <KpiTile
              labelKey="dashboard.stats.activeDevices"
              value={deviceStatuses.isLoading ? null : activeDevices}
              icon={Cpu}
              tone="info"
              loading={deviceStatuses.isLoading}
            />
            <KpiTile
              labelKey="dashboard.stats.activeAlarms"
              value={alarms.isLoading ? null : activeAlarms}
              icon={History}
              tone={activeAlarms > 0 ? 'danger' : 'gray'}
              loading={alarms.isLoading}
            />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className={canReadReports ? 'lg:col-span-4' : 'lg:col-span-6'}>
          <ActivityStatusChart
            counts={counts}
            loading={mapVehicles.isLoading && !mapVehicles.isError}
            error={mapVehicles.isError ? mapVehicles.error : undefined}
            onRetry={() => void mapVehicles.refetch()}
          />
        </div>
        {canReadReports && (
          <div className="lg:col-span-5">
            <DistanceTrendChart />
          </div>
        )}
        <div className={canReadReports ? 'lg:col-span-3' : 'lg:col-span-6'}>
          <FleetHealthPanel
            vehicles={vehicles}
            loading={mapVehicles.isLoading}
            error={mapVehicles.isError ? mapVehicles.error : undefined}
            onRetry={() => void mapVehicles.refetch()}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-6">
          <FleetMapPreviewCard />
        </div>
        <div className="min-w-0 xl:col-span-3">
          <MaintenanceStatusCard />
        </div>
        <div className="min-w-0 xl:col-span-3">
          <RecentEventsPanel />
        </div>
      </div>

      <PermissionGate requires={PERMISSIONS.reportRead}>
        <section aria-labelledby="dash-period-heading" className="flex flex-col gap-3">
          <SectionLabel
            id="dash-period-heading"
            icon={TrendingUp}
            title={t('dashboard.sectionLabels.period')}
            hint={t('dashboard.sectionLabels.periodHint')}
          />
          <ReportsKpiRow />
        </section>
      </PermissionGate>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <FleetComparisonChart />
        </div>
        <div className="lg:col-span-5">
          <SpeedLeadersChart />
        </div>
      </div>

      <PermissionGate requires={PERMISSIONS.reportRead}>
        <TrendChartsRow />
      </PermissionGate>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <HourlyActivityChart />
        </div>
        <div className="lg:col-span-3">
          <AlarmSeverityChart />
        </div>
        <div className="lg:col-span-4">
          <AlertTypeBreakdownChart />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {canReadReports && (
          <div className="lg:col-span-4">
            <DurationMixChart />
          </div>
        )}
        <div className={canReadReports ? 'lg:col-span-4' : 'lg:col-span-7'}>
          <PermissionGate requires={PERMISSIONS.reportRead}>
            <TopVehiclesChart />
          </PermissionGate>
        </div>
        <div className={canReadReports ? 'lg:col-span-4' : 'lg:col-span-5'}>
          <PermissionGate requires={PERMISSIONS.reportRead}>
            <AlarmStatusChart />
          </PermissionGate>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({
  id,
  icon: Icon,
  title,
  hint,
}: {
  id: string;
  icon: typeof Radio;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2
        id={id}
        className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white"
      >
        <Icon size={15} className="text-brand-600 dark:text-brand-300" aria-hidden />
        {title}
      </h2>
      <p className="text-xs text-gray-500 dark:text-graydark-600">{hint}</p>
    </div>
  );
}

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
  WifiOff,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useActiveAlarms, useDeviceStatuses, useFleetStats, useMapVehicles } from '@/api/fleet.api';
import { PERMISSIONS, PermissionGate, usePermissions } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { Card, PageHeader } from '@/components/tailwind-ui';
import { LiveBadge } from './LiveBadge';

import { ActivityStatusChart, countStates } from './ActivityStatusChart';
import { AlarmSeverityChart } from './AlarmSeverityChart';
import { AlarmStatusChart } from './AlarmStatusChart';
import { AlertTypeBreakdownChart } from './AlertTypeBreakdownChart';
import { DurationMixChart } from './DurationMixChart';
import { FleetComparisonChart } from './FleetComparisonChart';
import { FleetHealthPanel } from './FleetHealthPanel';
import { FleetMapPreviewCard } from './FleetMapPreviewCard';
import { HourlyActivityChart } from './HourlyActivityChart';
import { KpiChip, KpiTile } from './KpiTile';
import { RecentEventsPanel } from './RecentEventsPanel';
import { ReportsKpiRow } from './ReportsKpiRow';
import { SpeedLeadersChart } from './SpeedLeadersChart';
import { TopVehiclesChart } from './TopVehiclesChart';
import { TrendChartsRow } from './TrendChartsRow';

/**
 * FleetDashboard — professional fleet operations console.
 *
 * Composition (real APIs only; mock mode uses the same fixtures):
 *
 * 0. PageHeader (TailAdmin) + live connectivity pills
 * 1. Live KPI row — registry / movement / devices / alarms
 * 2. Period KPI row (report.read) — 7d distance, trips, utilization,
 *    moving/idle hours, avg/max speed, geofence, speeding, critical
 * 3. Live activity donut + fleet health + duration mix (7d)
 * 4. Fleet comparison + speed leaders
 * 5. Trends (distance/trips + stacked alarms)
 * 6. Hourly rhythm + severity + alert types
 * 7. Recent events + distance leaders + alarm lifecycle
 * 8. Live map preview
 *
 * Every panel isolates loading/empty/error — one failing service never blanks
 * the dashboard.
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
  const totalDevices = Math.max(devices.length, 1);
  const onlinePct = Math.round((activeDevices / totalDevices) * 100);
  const movingPct =
    counts.driving + counts.idle > 0
      ? Math.round((counts.driving / (counts.driving + counts.idle)) * 100)
      : null;

  return (
    <div className="flex w-full flex-col gap-5">
      {/* ── 0. Page header (TailAdmin — no gradient banner) ── */}
      <PageHeader
        eyebrow={t('nav.dashboard')}
        title={t('dashboard.title')}
        description={t('dashboard.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold tabular-nums text-gray-700 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-700">
              <Wifi size={14} className="text-success-600 dark:text-success-400" />
              {onlinePct}% {t('dashboard.heroConnectivity')}
            </span>
            {movingPct !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold tabular-nums text-gray-700 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-700">
                <Truck size={14} className="text-brand-600 dark:text-brand-300" />
                {movingPct}% {t('dashboard.heroActiveShare')}
              </span>
            )}
            <LiveBadge />
            <Link
              to="/map"
              className="inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-xs font-medium text-brand-600 ring-1 ring-inset ring-brand-500 transition-colors hover:bg-brand-50 dark:text-brand-300 dark:ring-brand-400/60 dark:hover:bg-brand-500/10"
            >
              {t('dashboard.widgets.openMap')}
            </Link>
          </div>
        }
        divider
      />

      {/* ── 1. LIVE status ── */}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
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
              labelKey="dashboard.stats.offline"
              value={stats.data?.offline ?? counts.offline}
              icon={WifiOff}
              tone="gray"
              loading={stats.isLoading && mapVehicles.isLoading}
            />
            <KpiTile
              labelKey="dashboard.stats.activeDevices"
              value={deviceStatuses.isLoading ? null : activeDevices}
              icon={Cpu}
              tone="info"
              loading={deviceStatuses.isLoading}
              footer={
                !deviceStatuses.isLoading && (
                  <KpiChip
                    tone={onlinePct >= 80 ? 'success' : onlinePct >= 50 ? 'warning' : 'danger'}
                  >
                    {onlinePct}%
                  </KpiChip>
                )
              }
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

      {/* ── 2. Period performance (reporting-service, last 7 days) ── */}
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

      {/* ── 3. Activity + health + duration mix ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className={canReadReports ? 'lg:col-span-4' : 'lg:col-span-5'}>
          <ActivityStatusChart
            counts={counts}
            loading={mapVehicles.isLoading && !mapVehicles.isError}
            error={mapVehicles.isError ? mapVehicles.error : undefined}
            onRetry={() => void mapVehicles.refetch()}
          />
        </div>
        <div className={canReadReports ? 'lg:col-span-4' : 'lg:col-span-7'}>
          <FleetHealthPanel
            vehicles={vehicles}
            loading={mapVehicles.isLoading}
            error={mapVehicles.isError ? mapVehicles.error : undefined}
            onRetry={() => void mapVehicles.refetch()}
          />
        </div>
        {canReadReports && (
          <div className="lg:col-span-4">
            <DurationMixChart />
          </div>
        )}
      </div>

      {/* ── 4. Fleet comparison + speed leaders ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <FleetComparisonChart />
        </div>
        <div className="lg:col-span-5">
          <SpeedLeadersChart />
        </div>
      </div>

      {/* ── 5. Trends ── */}
      <PermissionGate requires={PERMISSIONS.reportRead}>
        <TrendChartsRow />
      </PermissionGate>

      {/* ── 6. Dispatch rhythm + alarm severity + alert types ── */}
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

      {/* ── 7. Recent events + distance leaderboard + alarm lifecycle ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <RecentEventsPanel />
        </div>
        <div className="lg:col-span-4">
          <PermissionGate requires={PERMISSIONS.reportRead}>
            <TopVehiclesChart />
          </PermissionGate>
        </div>
        <div className="lg:col-span-3">
          <PermissionGate requires={PERMISSIONS.reportRead}>
            <AlarmStatusChart />
          </PermissionGate>
        </div>
      </div>

      {/* ── 8. Live map preview ── */}
      <FleetMapPreviewCard />
    </div>
  );
}

/** Compact section heading used between dashboard bands. */
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
      <h2 id={id} className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white">
        <Icon size={15} className="text-brand-600 dark:text-brand-300" aria-hidden />
        {title}
      </h2>
      <p className="text-xs text-gray-500 dark:text-graydark-600">{hint}</p>
    </div>
  );
}

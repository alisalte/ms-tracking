import { Activity, Cpu, Gauge, History, MapPin, Radio, Truck, Wifi, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveAlarms, useDeviceStatuses, useFleetStats, useMapVehicles } from '@/api/fleet.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/tailwind-ui';
import { LiveBadge } from './LiveBadge';

import { ActivityStatusChart, countStates } from './ActivityStatusChart';
import { AlarmSeverityChart } from './AlarmSeverityChart';
import { AlarmStatusChart } from './AlarmStatusChart';
import { AlertTypeBreakdownChart } from './AlertTypeBreakdownChart';
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
 * FleetDashboard — the fleet operations console (Phase 5).
 *
 * Composition (all REAL data via the existing API hooks — no new endpoints,
 * no fabricated values; mock mode falls back to the same fixtures):
 *
 * 0. Hero header — gradient command strip: title, live badge, quick pills
 *    (connectivity %, active fleet share).
 * 1. LIVE KPI row — total / moving / idle / parked / offline / active devices /
 *    active alarms, each with a real footer chip.
 * 2. Period KPI row (report.read) — 7-day distance, trips, utilization,
 *    geofence events, fleet avg speed, critical alarms.
 * 3. Activity donut + fleet health meters.
 * 4. Fleet comparison (per-fleet stacked activity) + speed leaders (7d).
 * 5. Trend charts — distance+trips combo, stacked daily alarms (7d/30d).
 * 6. Hourly dispatch rhythm (today) + alarm severity mix (7d) + alert types.
 * 7. Recent events feed + distance leaderboard + alarm lifecycle.
 * 8. Full-width live map preview.
 *
 * Every panel isolates its own loading/empty/error state — one failing service
 * never blanks the dashboard (§22 honest failure).
 */
export function FleetDashboard() {
  const { t } = useTranslation();
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
      {/* ── 0. Hero header — operations command strip ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-brand-600 via-brand-500 to-info-500 p-5 text-white shadow-lg shadow-brand-500/20 sm:p-6 dark:from-brand-700 dark:via-brand-600 dark:to-info-600">
        {/* Decorative rings */}
        <span
          aria-hidden
          className="pointer-events-none absolute -end-16 -top-24 size-64 rounded-full border border-white/15"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -end-8 -top-16 size-40 rounded-full border border-white/10"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute start-1/3 -bottom-28 size-56 rounded-full bg-white/8 blur-2xl"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm [&_svg]:size-6">
                <Radio />
              </span>
              <h1 className="text-xl font-black tracking-tight sm:text-2xl">
                {t('dashboard.title')}
              </h1>
            </div>
            <p className="mt-2 max-w-xl text-sm text-white/80">{t('dashboard.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-2 rounded-xl bg-white/12 px-3.5 py-2 text-sm font-bold tabular-nums backdrop-blur-sm">
              <Wifi size={15} />
              {onlinePct}% {t('dashboard.heroConnectivity')}
            </span>
            {movingPct !== null && (
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/12 px-3.5 py-2 text-sm font-bold tabular-nums backdrop-blur-sm">
                <Truck size={15} />
                {movingPct}% {t('dashboard.heroActiveShare')}
              </span>
            )}
            <LiveBadge />
          </div>
        </div>
      </div>

      {/* ── 1. LIVE KPI row ── */}
      {stats.isError ? (
        <Card flush className="p-2">
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
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

      {/* ── 2. Period KPI row (reporting-service, last 7 days) ── */}
      <PermissionGate requires={PERMISSIONS.reportRead}>
        <ReportsKpiRow />
      </PermissionGate>

      {/* ── 3. Activity + Fleet health ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <ActivityStatusChart
            counts={counts}
            loading={mapVehicles.isLoading && !mapVehicles.isError}
            error={mapVehicles.isError ? mapVehicles.error : undefined}
            onRetry={() => void mapVehicles.refetch()}
          />
        </div>
        <div className="lg:col-span-7">
          <FleetHealthPanel
            vehicles={vehicles}
            loading={mapVehicles.isLoading}
            error={mapVehicles.isError ? mapVehicles.error : undefined}
            onRetry={() => void mapVehicles.refetch()}
          />
        </div>
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

      {/* ── 5. Trends (distance/trips combo + stacked alarms; report.read) ── */}
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

      {/* ── 8. Live map preview (full width) ── */}
      <FleetMapPreviewCard />
    </div>
  );
}

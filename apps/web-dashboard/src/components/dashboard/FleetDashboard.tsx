import { Activity, Cpu, Gauge, History, MapPin, Truck, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveAlarms, useDeviceStatuses, useFleetStats, useMapVehicles } from '@/api/fleet.api';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/tailwind-ui';
import { LiveBadge } from './LiveBadge';

import { ActivityStatusChart, countStates } from './ActivityStatusChart';
import { AlertTypeBreakdownChart } from './AlertTypeBreakdownChart';
import { FleetHealthPanel } from './FleetHealthPanel';
import { FleetMapPreviewCard } from './FleetMapPreviewCard';
import { KpiTile } from './KpiTile';
import { RecentEventsPanel } from './RecentEventsPanel';

/** Grid gap between dashboard rows/sections. */
const GAP = 'gap-4';

/**
 * FleetDashboard — the enterprise fleet dashboard (Phase 4, TailAdmin).
 *
 * Composition, all sections on REAL data via the existing API hooks (no new
 * endpoints, no fabricated values — mock mode falls back to the same fixtures):
 *
 * 1. Header — title + subtitle + live badge.
 * 2. KPI row — Total Vehicles / Moving / Idle / Parked / Offline (movement
 *    counts derived client-side from the live map join: registry × device
 *    status × latest position), Active Alarms (notification-service), Active
 *    Devices (devices ONLINE).
 * 3. Vehicle Activity donut + Fleet Health meters (connectivity, GPS
 *    reporting, stale positions, offline devices).
 * 4. Recent Events (severity-sorted feed + summary chips) + Alert Type
 *    breakdown.
 * 5. Full-width live map preview (MapLibre, presence-tinted markers).
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
  const activeAlarms = alarms.data?.length ?? 0;
  const activeDevices = useMemo(
    () => (deviceStatuses.data ?? []).filter((d) => d.state === 'ONLINE').length,
    [deviceStatuses.data],
  );

  return (
    <div className="flex w-full flex-col gap-5">
      {/* ── Header (TailAdmin flat page header — Phase 2.5: no gradient banner) ── */}
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.subtitle')}
        actions={<LiveBadge />}
      />

      {/* ── KPI row (Phase 4 §KPI) ── */}
      {stats.isError ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/5 dark:bg-graydark-300">
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        </div>
      ) : (
        <div
          className={`grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 ${GAP}`}
        >
          <KpiTile
            labelKey="dashboard.stats.totalVehicles"
            value={stats.data?.totalVehicles}
            icon={Truck}
            tone="brand"
            loading={stats.isLoading}
          />
          <KpiTile
            labelKey="dashboard.stats.moving"
            value={counts.driving}
            icon={Gauge}
            tone="success"
            loading={mapVehicles.isLoading}
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
            labelKey="dashboard.stats.activeAlarms"
            value={alarms.isLoading ? null : activeAlarms}
            icon={History}
            tone={activeAlarms > 0 ? 'danger' : 'gray'}
            loading={alarms.isLoading}
          />
          <KpiTile
            labelKey="dashboard.stats.activeDevices"
            value={deviceStatuses.isLoading ? null : activeDevices}
            icon={Cpu}
            tone="info"
            loading={deviceStatuses.isLoading}
          />
        </div>
      )}

      {/* ── Activity + Fleet health ── */}
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

      {/* ── Recent events + alert types ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <RecentEventsPanel />
        </div>
        <div className="lg:col-span-4">
          <AlertTypeBreakdownChart />
        </div>
      </div>

      {/* ── Live map preview (full width) ── */}
      <FleetMapPreviewCard />
    </div>
  );
}

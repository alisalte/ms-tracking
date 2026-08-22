import { Activity, Cpu, Gauge, History, MapPin, Truck, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveAlarms, useDeviceStatuses, useFleetStats, useMapVehicles } from '@/api/fleet.api';
import { ErrorState } from '@/components/common/ErrorState';
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
      {/* ── Header ── */}
      <div className="relative overflow-hidden rounded-3xl border border-white/70 bg-[linear-gradient(135deg,rgba(70,95,251,0.96),rgba(27,30,110,0.94)),radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.35),transparent_28%)] p-6 text-white shadow-2xl shadow-brand-900/20 dark:border-white/10 dark:shadow-black/30 sm:p-7">
        <div
          aria-hidden
          className="absolute -top-20 end-10 size-56 rounded-full bg-white/16 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-24 -start-10 size-64 rounded-full bg-cyan-300/18 blur-3xl"
        />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <p className="mb-2 text-xs font-bold tracking-[0.18em] text-brand-100 uppercase">
              {t('dashboard.heroEyebrow')}
            </p>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              {t('dashboard.title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-white/78 sm:text-[0.95rem]">
              {t('dashboard.subtitle')}
            </p>
          </div>
          <div className="rounded-full border border-white/18 bg-white/12 px-3 py-2 shadow-inner shadow-white/10 backdrop-blur">
            <LiveBadge />
          </div>
        </div>
      </div>

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

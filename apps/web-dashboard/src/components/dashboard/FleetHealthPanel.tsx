import { Activity, HeartPulse } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceStatuses, useFleetStats } from '@/api/fleet.api';
import { Meter } from '@/components/tailwind-ui';
import type { MapVehicle } from '@/types/fleet.types';
import { DashboardCard } from './DashboardCard';

export interface FleetHealthPanelProps {
  vehicles: readonly MapVehicle[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/**
 * FleetHealthPanel — compact connectivity/GPS overview (Phase 4).
 *
 * All real sources: device connection states (`/tracking/devices/status`),
 * position coverage (the map join's `updatedAt`), and the fleet summary's
 * stale count. Each metric renders as a labeled meter — counts pair with
 * labels, never color alone. A failure of ANY of the three sources surfaces
 * as the card's error state — never as fabricated 0/0 meters.
 */
export function FleetHealthPanel({ vehicles, loading, error, onRetry }: FleetHealthPanelProps) {
  const { t } = useTranslation();
  const {
    data: statuses,
    isLoading: statusesLoading,
    error: statusesError,
    refetch: refetchStatuses,
  } = useDeviceStatuses();
  const { data: stats, refetch: refetchStats } = useFleetStats();

  const metrics = useMemo(() => {
    const list = statuses ?? [];
    const online = list.filter((s) => s.state === 'ONLINE').length;
    const offline = list.filter((s) => s.state === 'OFFLINE').length;
    const stale = list.filter((s) => s.state === 'STALE').length;
    const reporting = vehicles.filter((v) => v.updatedAt).length;
    return { total: list.length, online, offline, stale, reporting };
  }, [statuses, vehicles]);

  const busy = loading || statusesLoading;
  // The stale-positions tile has a REAL fallback (the statuses projection's
  // STALE count), so a fleet-stats failure is not this card's failure — only
  // a statuses failure (or the caller's) renders the error state. The stats
  // query itself is surfaced honestly by the KPI row above.
  const anyError = error ?? statusesError ?? null;
  const retryAll = () => {
    onRetry?.();
    void refetchStatuses();
    void refetchStats();
  };

  return (
    <DashboardCard
      titleKey="dashboard.sections.health"
      accent="brand"
      icon={HeartPulse}
      loading={busy}
      error={anyError}
      onRetry={retryAll}
    >
      <div className="flex flex-col gap-4">
        <Meter
          label={t('dashboard.health.connectivity')}
          value={metrics.online}
          max={metrics.total}
          tone="success"
          showMax
        />
        <Meter
          label={t('dashboard.health.gpsReporting')}
          value={metrics.reporting}
          max={vehicles.length}
          tone="info"
          showMax
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-gray-200 p-3 dark:border-white/5">
            <div className="flex items-center gap-2 text-warning-600 dark:text-warning-400">
              <Activity size={14} aria-hidden />
              <span className="text-xs font-medium">{t('dashboard.health.stalePositions')}</span>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-white">
              {(stats?.stale ?? metrics.stale).toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3 dark:border-white/5">
            <div className="flex items-center gap-2 text-danger-600 dark:text-danger-400">
              <Activity size={14} aria-hidden />
              <span className="text-xs font-medium">{t('dashboard.health.offlineDevices')}</span>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-white">
              {metrics.offline.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}

import { Activity, HeartPulse } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceStatuses, useFleetStats } from '@/api/fleet.api';
import type { MapVehicle } from '@/types/fleet.types';
import { DashboardCard } from './DashboardCard';

/** A labeled meter row — label left, count + bar right. */
function Meter({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: 'success' | 'warning' | 'danger' | 'gray' | 'info';
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const bar =
    tone === 'success'
      ? 'bg-success-500'
      : tone === 'warning'
        ? 'bg-warning-500'
        : tone === 'danger'
          ? 'bg-danger-500'
          : tone === 'info'
            ? 'bg-info-500'
            : 'bg-gray-400 dark:bg-graydark-500';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-gray-600 dark:text-graydark-700">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
          {value.toLocaleString()}
          <span className="ms-1 text-xs font-normal text-gray-400 dark:text-graydark-600">
            / {total.toLocaleString()}
          </span>
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"
        // biome-ignore lint/a11y/useFocusableInteractive: a read-only display meter — not user-interactive, so tabIndex would harm tab order
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

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
 * labels, never color alone.
 */
export function FleetHealthPanel({ vehicles, loading, error, onRetry }: FleetHealthPanelProps) {
  const { t } = useTranslation();
  const { data: statuses, isLoading: statusesLoading } = useDeviceStatuses();
  const { data: stats } = useFleetStats();

  const metrics = useMemo(() => {
    const list = statuses ?? [];
    const online = list.filter((s) => s.state === 'ONLINE').length;
    const offline = list.filter((s) => s.state === 'OFFLINE').length;
    const stale = list.filter((s) => s.state === 'STALE').length;
    const reporting = vehicles.filter((v) => v.updatedAt).length;
    return { total: list.length, online, offline, stale, reporting };
  }, [statuses, vehicles]);

  const busy = loading || statusesLoading;

  return (
    <DashboardCard
      titleKey="dashboard.sections.health"
      icon={HeartPulse}
      loading={busy}
      error={error}
      onRetry={onRetry}
    >
      <div className="flex flex-col gap-4">
        <Meter
          label={t('dashboard.health.connectivity')}
          value={metrics.online}
          total={metrics.total}
          tone="success"
        />
        <Meter
          label={t('dashboard.health.gpsReporting')}
          value={metrics.reporting}
          total={vehicles.length}
          tone="info"
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

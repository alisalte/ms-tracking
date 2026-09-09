import type { ApexOptions } from 'apexcharts';
import { useQuery } from '@tanstack/react-query';
import { Activity, HeartPulse } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchAlarms } from '@/api/alarm.api';
import { useDeviceStatuses, useFleetStats } from '@/api/fleet.api';
import { Meter } from '@/components/tailwind-ui';
import {
  computeFleetHealthScore,
  healthScoreTone,
  type HealthAlarmSeverity,
} from '@/lib/fleet-health-score';
import { formatNumber } from '@/lib/format-number';
import { chart } from '@/theme/palette';
import type { MapVehicle } from '@/types/fleet.types';
import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

export interface FleetHealthPanelProps {
  vehicles: readonly MapVehicle[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/**
 * FleetHealthPanel — connectivity meters + rule-based Fleet Health Score v1.
 *
 * Score = mean of per-vehicle scores (60% presence + 40% open-alarm headroom).
 */
export function FleetHealthPanel({ vehicles, loading, error, onRetry }: FleetHealthPanelProps) {
  const { t, i18n } = useTranslation();
  const {
    data: statuses,
    isLoading: statusesLoading,
    error: statusesError,
    refetch: refetchStatuses,
  } = useDeviceStatuses();
  const { data: stats, refetch: refetchStats } = useFleetStats();
  const openAlarmsQ = useQuery({
    queryKey: ['fleet', 'health', 'open-alarms'],
    queryFn: () => fetchAlarms({ status: 'OPEN', limit: 100 }),
  });

  const metrics = useMemo(() => {
    const list = statuses ?? [];
    const online = list.filter((s) => s.state === 'ONLINE').length;
    const offline = list.filter((s) => s.state === 'OFFLINE').length;
    const stale = list.filter((s) => s.state === 'STALE').length;
    const reporting = vehicles.filter((v) => v.updatedAt).length;
    return { total: list.length, online, offline, stale, reporting };
  }, [statuses, vehicles]);

  const health = useMemo(() => {
    const openAlarms = (openAlarmsQ.data ?? []).map((a) => ({
      vehicleId: a.vehicleId,
      severity: a.severity as HealthAlarmSeverity,
    }));
    return computeFleetHealthScore(
      vehicles.map((v) => ({ vehicleId: v.id, presence: v.presence })),
      openAlarms,
    );
  }, [vehicles, openAlarmsQ.data]);

  const scoreTone = healthScoreTone(health.score);
  const scoreToneClass =
    scoreTone === 'success'
      ? 'text-success-600 dark:text-success-400'
      : scoreTone === 'warning'
        ? 'text-warning-600 dark:text-warning-400'
        : scoreTone === 'danger'
          ? 'text-danger-600 dark:text-danger-400'
          : 'text-gray-500 dark:text-gray-400';

  const slices = useMemo(
    () =>
      [
        { label: t('dashboard.health.onlineDevices'), value: metrics.online, color: chart.moving },
        { label: t('dashboard.health.staleDevices'), value: metrics.stale, color: chart.idle },
        {
          label: t('dashboard.health.offlineDevices'),
          value: metrics.offline,
          color: chart.offline,
        },
      ].filter((s) => s.value > 0),
    [metrics, t],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      labels: slices.map((s) => s.label),
      colors: slices.map((s) => s.color),
      legend: { position: 'bottom' },
      plotOptions: {
        pie: {
          donut: {
            size: '72%',
            labels: {
              show: true,
              total: {
                show: true,
                label: t('dashboard.health.healthyShare'),
                formatter: () => formatNumber(metrics.total, i18n.language),
              },
            },
          },
        },
      },
    }),
    [slices, metrics.total, t, i18n.language],
  );

  const busy = loading || statusesLoading;
  const anyError = error ?? statusesError ?? null;
  const retryAll = () => {
    onRetry?.();
    void refetchStatuses();
    void refetchStats();
    void openAlarmsQ.refetch();
  };

  return (
    <DashboardCard
      titleKey="dashboard.sections.health"
      accent="success"
      icon={HeartPulse}
      loading={busy}
      error={anyError}
      onRetry={retryAll}
      flush
    >
      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
        <div className="rounded-xl border border-gray-200 p-3 dark:border-white/5">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('dashboard.health.fleetScore')}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className={`text-3xl font-bold tabular-nums ${scoreToneClass}`}>
              {openAlarmsQ.isLoading || health.score == null
                ? '—'
                : formatNumber(health.score, i18n.language)}
            </span>
            {health.score != null && !openAlarmsQ.isLoading && (
              <span className="text-sm text-gray-500 dark:text-gray-400">/ 100</span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('dashboard.health.fleetScoreHint')}
          </p>
          {!openAlarmsQ.isLoading && health.attentionCount > 0 && (
            <p className="mt-1 text-xs font-medium text-warning-600 dark:text-warning-400">
              {t('dashboard.health.attentionVehicles', { count: health.attentionCount })}
            </p>
          )}
        </div>

        {slices.length > 0 && (
          <ApexChart
            type="donut"
            series={slices.map((s) => s.value)}
            options={options}
            height={180}
          />
        )}
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
          <div className="rounded-xl border border-gray-200 p-3 dark:border-white/5">
            <div className="flex items-center gap-2 text-warning-600 dark:text-warning-400">
              <Activity size={14} aria-hidden />
              <span className="text-xs font-medium">{t('dashboard.health.stalePositions')}</span>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-white">
              {formatNumber(stats?.stale ?? metrics.stale, i18n.language)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-3 dark:border-white/5">
            <div className="flex items-center gap-2 text-danger-600 dark:text-danger-400">
              <Activity size={14} aria-hidden />
              <span className="text-xs font-medium">{t('dashboard.health.offlineDevices')}</span>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-gray-900 dark:text-white">
              {formatNumber(metrics.offline, i18n.language)}
            </p>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}

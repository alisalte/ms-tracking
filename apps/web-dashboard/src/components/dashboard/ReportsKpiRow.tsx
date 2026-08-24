import { AlertTriangle, ArrowRightLeft, Fence, Gauge, Route, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAlarmReport, useFleetOverview, useSpeed } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';

import { KpiChip, KpiTile } from './KpiTile';

/** Period fixed at the trailing week — the dashboard's "at a glance" window. */
const RANGE = { preset: '7d' } as const;

/**
 * ReportsKpiRow — period KPI tiles from the reporting service (last 7 days).
 *
 * Six tiles: distance, trips, avg utilization, geofence events, fleet average
 * speed (from /reports/speed) and critical alarms (from /reports/alarms
 * summary) — each with a REAL footer chip for secondary context. Rendered only
 * for users holding `report.read` (gated by FleetDashboard).
 */
export function ReportsKpiRow() {
  const { t } = useTranslation();
  const overview = useFleetOverview(RANGE);
  const speed = useSpeed(RANGE);
  const alarms = useAlarmReport(RANGE);
  const o = overview.data;

  if (overview.isError) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/5 dark:bg-graydark-300">
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      </div>
    );
  }

  const loading = overview.isLoading;
  const utilization = o?.avgUtilizationPct ?? null;

  // Fleet-wide average speed: mean of per-vehicle averages (weighted by rows).
  const speedRows = (speed.data?.items ?? []).filter((r) => r.avgSpeedKph !== null);
  const avgSpeed =
    speedRows.length > 0
      ? Math.round(speedRows.reduce((s, r) => s + (r.avgSpeedKph ?? 0), 0) / speedRows.length)
      : null;
  const summary = alarms.data?.summary;
  const criticalAlarms = summary?.critical ?? null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      <KpiTile
        labelKey="dashboard.stats.distance7d"
        value={Math.round(o?.totalDistanceKm ?? 0)}
        icon={Route}
        tone="brand"
        loading={loading}
        footer={
          o && (
            <KpiChip tone="info">
              {Math.round((o.totalDistanceKm ?? 0) / 7).toLocaleString()} {t('dashboard.kmPerDay')}
            </KpiChip>
          )
        }
      />
      <KpiTile
        labelKey="dashboard.stats.trips7d"
        value={o?.totalTrips ?? 0}
        icon={ArrowRightLeft}
        tone="info"
        loading={loading}
        footer={
          o && (
            <KpiChip tone="gray">
              {Math.round((o.totalTrips ?? 0) / 7).toLocaleString()} / {t('dashboard.perDay')}
            </KpiChip>
          )
        }
      />
      <KpiTile
        labelKey="dashboard.stats.utilization"
        value={utilization === null ? null : Math.round(utilization)}
        suffix="%"
        icon={TrendingUp}
        tone="success"
        loading={loading}
        footer={
          o && (
            <KpiChip tone="gray">
              {t('dashboard.withTelemetry', { count: o.vehiclesWithTelemetry })}
            </KpiChip>
          )
        }
      />
      <KpiTile
        labelKey="dashboard.stats.avgSpeed"
        value={avgSpeed}
        suffix="km/h"
        icon={Gauge}
        tone="teal"
        loading={speed.isLoading && !speed.isError}
        footer={
          <KpiChip tone="gray">{t('dashboard.vehiclesCount', { count: speedRows.length })}</KpiChip>
        }
      />
      <KpiTile
        labelKey="dashboard.stats.geofenceEvents"
        value={o?.geofenceEvents ?? 0}
        icon={Fence}
        tone={o && o.geofenceEvents > 0 ? 'warning' : 'gray'}
        loading={loading}
      />
      <KpiTile
        labelKey="dashboard.stats.criticalAlarms"
        value={criticalAlarms}
        icon={criticalAlarms && criticalAlarms > 0 ? AlertTriangle : Fence}
        tone={criticalAlarms && criticalAlarms > 0 ? 'danger' : 'gray'}
        loading={alarms.isLoading && !alarms.isError}
        footer={
          summary && (
            <KpiChip tone={summary.open > 0 ? 'danger' : 'success'}>
              {t('dashboard.stats.openAlarmsCount', { count: summary.open })}
            </KpiChip>
          )
        }
      />
    </div>
  );
}

import {
  AlertTriangle,
  ArrowRightLeft,
  Clock,
  Fence,
  Gauge,
  Route,
  Timer,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAlarmReport, useFleetOverview } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/tailwind-ui';

import { hoursFromSec } from '@/lib/hours-from-sec';
import { KpiChip, KpiTile } from './KpiTile';

/** Period fixed at the trailing week — the dashboard's "at a glance" window. */
const RANGE = { preset: '7d' } as const;

/**
 * ReportsKpiRow — period KPI tiles from reporting-service (last 7 days).
 *
 * Grounded in REPORTING-KPI-DEFINITIONS: distance, trips, utilization,
 * moving/idle hours, trip-derived avg + max speed, geofence events,
 * speeding events, critical alarms. Uses fleet-overview expansions so
 * speed/duration are authoritative (not client-mean of rows).
 */
export function ReportsKpiRow() {
  const { t } = useTranslation();
  const overview = useFleetOverview(RANGE);
  const alarms = useAlarmReport(RANGE);
  const o = overview.data;

  const anyError = overview.error ?? alarms.error ?? null;
  if (anyError) {
    return (
      <Card flush className="p-2">
        <ErrorState
          error={anyError}
          onRetry={() => {
            void overview.refetch();
            void alarms.refetch();
          }}
        />
      </Card>
    );
  }

  const loading = overview.isLoading;
  const utilization = o?.avgUtilizationPct ?? null;
  const avgSpeed =
    o?.avgSpeedKmh !== null && o?.avgSpeedKmh !== undefined
      ? Math.round(o.avgSpeedKmh)
      : null;
  const maxSpeed =
    o?.maxSpeedKmh !== null && o?.maxSpeedKmh !== undefined
      ? Math.round(o.maxSpeedKmh)
      : null;
  const summary = alarms.data?.summary;
  const criticalAlarms = summary?.critical ?? null;
  const movingH = o ? hoursFromSec(o.movingDurationSec ?? 0) : null;
  const idleH = o ? hoursFromSec(o.idleDurationSec ?? 0) : null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-10">
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
        labelKey="dashboard.stats.movingHours"
        value={movingH}
        suffix="h"
        icon={Timer}
        tone="success"
        loading={loading}
        footer={
          o && o.discardedTrips > 0 ? (
            <KpiChip tone="gray">
              {t('dashboard.stats.discardedTrips', { count: o.discardedTrips })}
            </KpiChip>
          ) : undefined
        }
      />
      <KpiTile
        labelKey="dashboard.stats.idleHours"
        value={idleH}
        suffix="h"
        icon={Clock}
        tone="warning"
        loading={loading}
      />
      <KpiTile
        labelKey="dashboard.stats.avgSpeed"
        value={avgSpeed}
        suffix="km/h"
        icon={Gauge}
        tone="teal"
        loading={loading}
        footer={
          maxSpeed !== null && (
            <KpiChip tone="gray">
              {t('dashboard.stats.maxSpeedChip', { value: maxSpeed })}
            </KpiChip>
          )
        }
      />
      <KpiTile
        labelKey="dashboard.stats.maxSpeed"
        value={maxSpeed}
        suffix="km/h"
        icon={Zap}
        tone={maxSpeed !== null && maxSpeed >= 110 ? 'danger' : 'info'}
        loading={loading}
      />
      <KpiTile
        labelKey="dashboard.stats.geofenceEvents"
        value={o?.geofenceEvents ?? 0}
        icon={Fence}
        tone={o && o.geofenceEvents > 0 ? 'warning' : 'gray'}
        loading={loading}
      />
      <KpiTile
        labelKey="dashboard.stats.speedingEvents"
        value={o?.speedingEventCount ?? 0}
        icon={AlertTriangle}
        tone={o && o.speedingEventCount > 0 ? 'danger' : 'gray'}
        loading={loading}
      />
      <KpiTile
        labelKey="dashboard.stats.criticalAlarms"
        value={criticalAlarms}
        icon={AlertTriangle}
        tone={criticalAlarms && criticalAlarms > 0 ? 'danger' : 'gray'}
        loading={alarms.isLoading}
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

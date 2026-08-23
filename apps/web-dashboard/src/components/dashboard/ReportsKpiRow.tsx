import { ArrowRightLeft, Fence, Route, TrendingUp } from 'lucide-react';

import { useFleetOverview } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';

import { KpiTile } from './KpiTile';

/** Period fixed at the trailing week — the dashboard's "at a glance" window. */
const RANGE = { preset: '7d' } as const;

/**
 * ReportsKpiRow — period KPI tiles from the reporting service (last 7 days).
 *
 * Complements the LIVE KPI row (registry/status counters) with aggregated
 * period metrics — distance, trips, utilization, geofence events — all from
 * the backend's documented KPI formulas (`GET /reports/fleet-overview`).
 * Rendered only for users holding `report.read` (gated by FleetDashboard).
 */
export function ReportsKpiRow() {
  const overview = useFleetOverview(RANGE);
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

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <KpiTile
        labelKey="dashboard.stats.distance7d"
        value={Math.round(o?.totalDistanceKm ?? 0)}
        icon={Route}
        tone="brand"
        loading={loading}
      />
      <KpiTile
        labelKey="dashboard.stats.trips7d"
        value={o?.totalTrips ?? 0}
        icon={ArrowRightLeft}
        tone="info"
        loading={loading}
      />
      <KpiTile
        labelKey="dashboard.stats.utilization"
        value={utilization === null ? null : Math.round(utilization)}
        suffix="%"
        icon={TrendingUp}
        tone="success"
        loading={loading}
      />
      <KpiTile
        labelKey="dashboard.stats.geofenceEvents"
        value={o?.geofenceEvents ?? 0}
        icon={Fence}
        tone={o && o.geofenceEvents > 0 ? 'warning' : 'gray'}
        loading={loading}
      />
    </div>
  );
}

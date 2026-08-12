import type { TFunction } from 'i18next';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useFleetStats } from '@/api/fleet.api';
import { Button } from '@/components/tailwind-ui';
import { status } from '@/theme/palette';

import { ActiveAlertsPanel } from './ActiveAlertsPanel';
import { AlertTypeBreakdownChart } from './AlertTypeBreakdownChart';
import { FleetActivityChart } from './FleetActivityChart';
import { FleetMapPreview } from './FleetMapPreview';
import { FleetPerformanceChart } from './FleetPerformanceChart';
import { FleetUtilizationPanel } from './FleetUtilizationPanel';
import { KpiCard } from './KpiCard';
import { LiveBadge } from './LiveBadge';
import { VehiclesAttentionList } from './VehiclesAttentionList';
import { WeatherWidget } from './WeatherWidget';

/**
 * DashboardGrid — the Fleet Dashboard, rebuilt as a TailAdmin-style dashboard.
 *
 * Layout (TailAdmin dashboard pattern):
 * 1. Page header: fleet name + live badge + export
 * 2. KPI card row — stat cards: circular icon badge + big value + label +
 *    trend %. Five headline metrics.
 * 3. Two-column grid: Fleet Activity chart (wide) + Active Alerts (narrow)
 * 4. Three-column grid: Alert types + Fleet Utilization + Performance
 * 5. Two-column grid: Vehicles Attention (wide) + Weather (narrow)
 * 6. Full-width Fleet Map Preview
 *
 * All data is mock-backed (useFleetStats) so the dashboard is fully demoable.
 */
export function DashboardGrid() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: stats } = useFleetStats();

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
              {t('dashboard.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-graydark-600">
              {t('dashboard.subtitle')}
            </p>
          </div>
          <LiveBadge />
        </div>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Download size={16} />}
          onClick={() => {
            /* Export deferred */
          }}
        >
          {t('dashboard.export')}
        </Button>
      </div>

      {/* ── KPI card row ── */}
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {kpiCards(stats, t, navigate).map((card) => (
          <KpiCard key={card.titleKey} {...card} />
        ))}
      </div>

      {/* ── Activity (8) + Alerts (4) ── */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <FleetActivityChart />
        </div>
        <div className="lg:col-span-4">
          <ActiveAlertsPanel />
        </div>
      </div>

      {/* ── Alert types (4) + Utilization (4) + Performance (4) ── */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <AlertTypeBreakdownChart />
        </div>
        <div className="lg:col-span-4">
          <FleetUtilizationPanel />
        </div>
        <div className="lg:col-span-4">
          <FleetPerformanceChart />
        </div>
      </div>

      {/* ── Attention (8) + Weather (4) ── */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <VehiclesAttentionList />
        </div>
        <div className="lg:col-span-4">
          <WeatherWidget />
        </div>
      </div>

      {/* ── Map preview (full width) ── */}
      <FleetMapPreview />
    </div>
  );
}

/** KPI card descriptors — circular icon + value + label + trend + sparkline. */
function kpiCards(
  s: ReturnType<typeof useFleetStats>['data'] | undefined,
  _t: TFunction,
  _navigate: (p: string) => void,
) {
  return [
    {
      titleKey: 'dashboard.stats.active',
      value: s?.totalActive ?? 0,
      icon: '🚛' as const,
      iconColor: status.success,
      delta: s?.deltas?.totalActive,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.totalActive,
    },
    {
      titleKey: 'dashboard.stats.driving',
      value: s?.driving ?? 0,
      icon: '🛣️' as const,
      iconColor: status.blue,
      delta: s?.deltas?.driving,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.driving,
    },
    {
      titleKey: 'dashboard.stats.idle',
      value: s?.idle ?? 0,
      icon: '🅿️' as const,
      iconColor: status.warning,
      delta: s?.deltas?.idle,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.idle,
    },
    {
      titleKey: 'dashboard.stats.alerts',
      value: s?.alerts ?? 0,
      icon: '🔔' as const,
      iconColor: status.danger,
      delta: s?.deltas?.alerts,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.alerts,
      meta:
        s && s.criticalAlerts > 0 ? (
          <span className="inline-flex items-center rounded-full border border-danger-300 px-1.5 py-0.5 text-[0.6rem] font-semibold text-danger-600">
            {s.criticalAlerts} CRIT
          </span>
        ) : undefined,
    },
    {
      titleKey: 'dashboard.stats.offline',
      value: s?.offline ?? 0,
      icon: '📡' as const,
      iconColor: status.slate,
      delta: s?.deltas?.offline,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.offline,
    },
  ];
}

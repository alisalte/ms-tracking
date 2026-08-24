import type { EChartsOption } from 'echarts';
import { Layers } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFleets, useVehicles } from '@/api/asset.api';
import { useDeviceStatuses, useMapVehicles } from '@/api/fleet.api';
import { status } from '@/theme/palette';

import { DashboardCard } from './DashboardCard';
import { EChart } from './EChart';

/**
 * FleetComparisonChart — per-fleet activity breakdown (live).
 *
 * Joins the live map-vehicles view with the registry (vehicle → fleet) and the
 * device-status projection, then renders each fleet as a horizontal stacked
 * bar: moving / idle / parked / offline. The "unassigned" bucket covers live
 * vehicles missing from the registry join.
 */
export function FleetComparisonChart() {
  const { t } = useTranslation();
  const fleets = useFleets();
  const vehicles = useVehicles();
  const mapVehicles = useMapVehicles();
  const deviceStatuses = useDeviceStatuses();

  const loading =
    fleets.isLoading || vehicles.isLoading || mapVehicles.isLoading || deviceStatuses.isLoading;

  // A failure of ANY joined source is a failed comparison — never render
  // fabricated zeros (empty fleets, swollen "unassigned") as if they were data.
  const anyError =
    mapVehicles.error ?? fleets.error ?? vehicles.error ?? deviceStatuses.error ?? null;
  const retryAll = () => {
    void mapVehicles.refetch();
    void fleets.refetch();
    void vehicles.refetch();
    void deviceStatuses.refetch();
  };

  const rows = useMemo(() => {
    const vehicleFleet = new Map<string, string>(
      (vehicles.data ?? []).map((v) => [v.id, v.fleetId ?? ''] as const),
    );
    const onlineDevices = new Set(
      (deviceStatuses.data ?? []).filter((d) => d.state === 'ONLINE').map((d) => d.deviceId),
    );

    const buckets = new Map<
      string,
      { moving: number; idle: number; parked: number; offline: number }
    >();
    const bucketOf = (key: string) => {
      let b = buckets.get(key);
      if (!b) {
        b = { moving: 0, idle: 0, parked: 0, offline: 0 };
        buckets.set(key, b);
      }
      return b;
    };
    bucketOf('__unassigned');

    for (const v of mapVehicles.data ?? []) {
      const fid = vehicleFleet.get(v.id) ?? '__unassigned';
      const b = bucketOf(fid);
      const online = !v.deviceId || onlineDevices.has(v.deviceId);
      if (!online) b.offline += 1;
      else if (v.speed > 5) b.moving += 1;
      else if (v.ignitionOn) b.idle += 1;
      else b.parked += 1;
    }
    // Fleets with no live vehicles still show an (empty) row for context.
    const out = (fleets.data ?? [])
      .filter((f) => f.status !== 'ARCHIVED')
      .map((f) => ({
        name: f.name,
        ...(buckets.get(f.id) ?? { moving: 0, idle: 0, parked: 0, offline: 0 }),
      }));
    const un = buckets.get('__unassigned');
    if (un && un.moving + un.idle + un.parked + un.offline > 0) {
      out.push({ name: t('dashboard.charts.unassigned'), ...un });
    }
    return out.sort((a, b) => b.moving + b.idle - (a.moving + a.idle)).slice(0, 8);
  }, [fleets.data, vehicles.data, mapVehicles.data, deviceStatuses.data, t]);

  const empty = !loading && !anyError && rows.length === 0;

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: {
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 11 },
      },
      grid: { left: 8, right: 16, top: 8, bottom: 34, containLabel: true },
      xAxis: { type: 'value', splitNumber: 4 },
      yAxis: {
        type: 'category',
        data: rows.map((r) => r.name).reverse(),
        axisLabel: { width: 110, overflow: 'truncate' },
      },
      series: [
        {
          name: t('dashboard.stats.moving'),
          type: 'bar',
          stack: 'fleet',
          barMaxWidth: 18,
          itemStyle: { color: status.success, borderRadius: 0 },
          data: rows.map((r) => r.moving).reverse(),
        },
        {
          name: t('dashboard.stats.idle'),
          type: 'bar',
          stack: 'fleet',
          barMaxWidth: 18,
          itemStyle: { color: status.warning },
          data: rows.map((r) => r.idle).reverse(),
        },
        {
          name: t('dashboard.stats.parked'),
          type: 'bar',
          stack: 'fleet',
          barMaxWidth: 18,
          itemStyle: { color: status.slate, opacity: 0.55 },
          data: rows.map((r) => r.parked).reverse(),
        },
        {
          name: t('dashboard.stats.offline'),
          type: 'bar',
          stack: 'fleet',
          barMaxWidth: 18,
          itemStyle: { color: status.danger, opacity: 0.75, borderRadius: [0, 3, 3, 0] },
          data: rows.map((r) => r.offline).reverse(),
        },
      ],
    }),
    [rows, t],
  );

  return (
    <DashboardCard
      titleKey="dashboard.widgets.fleetComparison"
      icon={Layers}
      accent="info"
      live
      loading={loading && !anyError}
      empty={empty}
      error={anyError}
      onRetry={retryAll}
      flush
    >
      <div className="w-full px-4 pb-2 sm:px-5">
        <EChart option={option} height={Math.max(220, rows.length * 44 + 60)} />
      </div>
    </DashboardCard>
  );
}

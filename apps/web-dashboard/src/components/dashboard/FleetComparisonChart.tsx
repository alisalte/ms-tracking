import type { ApexOptions } from 'apexcharts';
import { Layers } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFleets, useVehicles } from '@/api/asset.api';
import { useDeviceStatuses, useMapVehicles } from '@/api/fleet.api';
import { chart } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

/**
 * FleetComparisonChart — per-fleet activity breakdown (live).
 *
 * Joins the live map-vehicles view with the registry (vehicle → fleet) and the
 * device-status projection, then renders each fleet as a horizontal stacked
 * bar: moving / idle / parked / offline.
 */
export function FleetComparisonChart() {
  const { t } = useTranslation();
  const fleets = useFleets();
  const vehicles = useVehicles();
  const mapVehicles = useMapVehicles();
  const deviceStatuses = useDeviceStatuses();

  const loading =
    fleets.isLoading || vehicles.isLoading || mapVehicles.isLoading || deviceStatuses.isLoading;

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

  const categories = useMemo(() => rows.map((r) => r.name), [rows]);

  const series = useMemo(
    () => [
      { name: t('dashboard.stats.moving'), data: rows.map((r) => r.moving) },
      { name: t('dashboard.stats.idle'), data: rows.map((r) => r.idle) },
      { name: t('dashboard.stats.parked'), data: rows.map((r) => r.parked) },
      { name: t('dashboard.stats.offline'), data: rows.map((r) => r.offline) },
    ],
    [rows, t],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      chart: { stacked: true },
      colors: [chart.moving, chart.idle, chart.parked, chart.offline],
      plotOptions: {
        bar: {
          horizontal: true,
          barHeight: '62%',
          borderRadius: 6,
          borderRadiusApplication: 'end',
        },
      },
      legend: { position: 'bottom' },
      xaxis: { categories, labels: { trim: true } },
      yaxis: { labels: { maxWidth: 110 } },
      fill: { opacity: 1 },
      dataLabels: { enabled: false },
    }),
    [categories],
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
        <ApexChart
          type="bar"
          series={series}
          options={options}
          height={Math.max(220, rows.length * 44 + 60)}
        />
      </div>
    </DashboardCard>
  );
}

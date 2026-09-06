/**
 * DriversSection — assigned-vehicle meters rolled up per driver.
 */
import type { ApexOptions } from 'apexcharts';
import { Route, Timer, Truck, Users } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useVehicles } from '@/api/asset.api';
import { driverFullName, useDrivers } from '@/api/driver.api';
import { type ReportRange, type VehicleMetersRowWire, useVehicleMeters } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import { formatDurationSec, hours1, shortLabel } from '@/lib/report-format';
import { formatVehicleLabel } from '@/lib/vehicle-label';
import { chart } from '@/theme/palette';
import type { Driver, Vehicle } from '@/types/asset.types';

interface DriverReportRow {
  id: string;
  name: string;
  employeeId: string;
  vehicleLabel: string;
  assigned: boolean;
  trips: number;
  distanceKm: number;
  movingSec: number;
  idleSec: number;
}

function toRow(
  driver: Driver,
  vehicles: Map<string, Vehicle>,
  meters: Map<string, VehicleMetersRowWire>,
): DriverReportRow {
  const vehicle = driver.assignedVehicleId ? vehicles.get(driver.assignedVehicleId) : undefined;
  const m = driver.assignedVehicleId ? meters.get(driver.assignedVehicleId) : undefined;
  return {
    id: driver.id,
    name: driverFullName(driver),
    employeeId: driver.employeeId ?? '—',
    vehicleLabel: m?.label ?? (vehicle ? formatVehicleLabel(vehicle) : '—'),
    assigned: Boolean(driver.assignedVehicleId),
    trips: m?.trips ?? 0,
    distanceKm: m?.periodDistanceKm ?? 0,
    movingSec: m?.movingSec ?? 0,
    idleSec: m?.idleSec ?? 0,
  };
}

export function DriversSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const drivers = useDrivers();
  const vehicles = useVehicles();
  const meters = useVehicleMeters(range);

  const rows = useMemo(() => {
    const vehicleMap = new Map((vehicles.data ?? []).map((v) => [v.id, v]));
    const meterMap = new Map((meters.data?.items ?? []).map((m) => [m.vehicleId, m]));
    return (drivers.data ?? []).map((d) => toRow(d, vehicleMap, meterMap));
  }, [drivers.data, vehicles.data, meters.data]);

  const assigned = rows.filter((r) => r.assigned);
  const chartRows = useMemo(
    () => [...assigned].sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 12),
    [assigned],
  );

  const barOptions = useMemo<ApexOptions>(
    () => ({
      colors: [chart.distance],
      plotOptions: { bar: { borderRadius: 6, columnWidth: '48%' } },
      xaxis: {
        categories: chartRows.map((r) => shortLabel(r.name, 14)),
        labels: { rotate: -35, hideOverlappingLabels: true },
      },
      tooltip: { y: { formatter: (v: number) => `${v.toFixed(1)} km` } },
    }),
    [chartRows],
  );
  const barSeries = useMemo(
    () => [
      {
        name: t('reports.cols.distance'),
        data: chartRows.map((r) => Number(r.distanceKm.toFixed(1))),
      },
    ],
    [chartRows, t],
  );

  const columns: Column<DriverReportRow>[] = [
    { id: 'name', headerKey: 'reports.cols.driver', render: (r) => r.name },
    { id: 'employee', headerKey: 'reports.cols.employeeId', render: (r) => r.employeeId },
    {
      id: 'vehicle',
      headerKey: 'reports.cols.assignedVehicle',
      render: (r) => (r.assigned ? r.vehicleLabel : t('reports.drivers.unassigned')),
    },
    { id: 'trips', headerKey: 'reports.cols.trips', render: (r) => String(r.trips) },
    {
      id: 'distance',
      headerKey: 'reports.cols.distance',
      render: (r) => `${r.distanceKm.toFixed(1)} km`,
    },
    {
      id: 'moving',
      headerKey: 'reports.cols.moving',
      render: (r) => formatDurationSec(r.movingSec),
    },
    { id: 'idle', headerKey: 'reports.cols.idle', render: (r) => formatDurationSec(r.idleSec) },
  ];

  if (drivers.isLoading || meters.isLoading) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
      <div className="flex flex-col gap-4" role="status">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder.
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-2xl" />
      </div>
    );
  }

  if (drivers.isError) {
    return <ErrorState error={drivers.error} onRetry={() => drivers.refetch()} />;
  }
  if (meters.isError) {
    return <ErrorState error={meters.error} onRetry={() => meters.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="report-drivers">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          labelKey="reports.sections.drivers"
          value={rows.length}
          icon={Users}
          tone="brand"
        />
        <KpiTile
          labelKey="reports.drivers.assigned"
          value={assigned.length}
          icon={Truck}
          tone="info"
        />
        <KpiTile
          labelKey="reports.kpi.distance"
          value={Math.round(assigned.reduce((s, r) => s + r.distanceKm, 0) * 10) / 10}
          suffix=" km"
          icon={Route}
          tone="teal"
        />
        <KpiTile
          labelKey="dashboard.stats.movingHours"
          value={hours1(assigned.reduce((s, r) => s + r.movingSec, 0))}
          suffix="h"
          icon={Timer}
          tone="success"
        />
      </div>

      <Card>
        <CardHeader title={t('reports.charts.driversDistance')} />
        {chartRows.length === 0 ? (
          <EmptyChart label={t('reports.charts.empty')} />
        ) : (
          <ApexChart type="bar" series={barSeries} options={barOptions} height={280} />
        )}
      </Card>

      <ReportsTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyKey="reports.empty"
        dense
      />
      <p className="text-xs text-gray-500 dark:text-graydark-600">{t('reports.drivers.note')}</p>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center">
      <p className="text-sm text-gray-500 dark:text-graydark-600">{label}</p>
    </div>
  );
}

/**
 * DevicesSection — live connection state, last seen, and vehicle binding.
 */
import type { ApexOptions } from 'apexcharts';
import { Link2Off, Radio, Wifi, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDevices, useVehicles } from '@/api/asset.api';
import { useDeviceStatuses } from '@/api/fleet.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Badge, Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import { formatDateTime } from '@/lib/format-date';
import { lastSeenLabel } from '@/lib/relative-time';
import { formatVehicleLabel } from '@/lib/vehicle-label';
import { chart } from '@/theme/palette';
import type { VehiclePresence } from '@/types/fleet.types';

interface DeviceReportRow {
  id: string;
  imei: string;
  model: string;
  vehicleLabel: string;
  bound: boolean;
  presence: VehiclePresence;
  lastSeenAt: string | null;
  status: string;
}

const PRESENCE_TONE: Record<VehiclePresence, 'success' | 'danger' | 'warning' | 'gray'> = {
  ONLINE: 'success',
  OFFLINE: 'danger',
  STALE: 'warning',
  UNKNOWN: 'gray',
};

export function DevicesSection() {
  const { t } = useTranslation();
  const devices = useDevices();
  const vehicles = useVehicles();
  const statuses = useDeviceStatuses();

  const rows = useMemo<DeviceReportRow[]>(() => {
    const vehicleMap = new Map((vehicles.data ?? []).map((v) => [v.id, v]));
    const statusMap = new Map((statuses.data ?? []).map((s) => [s.deviceId, s]));
    return (devices.data ?? []).map((d) => {
      const st = statusMap.get(d.id);
      const vehicle = d.vehicleId ? vehicleMap.get(d.vehicleId) : undefined;
      return {
        id: d.id,
        imei: d.imei,
        model: d.model ?? d.manufacturer ?? d.protocol,
        vehicleLabel: vehicle ? formatVehicleLabel(vehicle) : '—',
        bound: Boolean(d.vehicleId),
        presence: st?.state ?? 'UNKNOWN',
        lastSeenAt: st?.lastSeenAt ?? d.lastSeenAt,
        status: d.status,
      };
    });
  }, [devices.data, vehicles.data, statuses.data]);

  const online = rows.filter((r) => r.presence === 'ONLINE').length;
  const offline = rows.filter((r) => r.presence === 'OFFLINE').length;
  const stale = rows.filter((r) => r.presence === 'STALE').length;
  const unknown = rows.filter((r) => r.presence === 'UNKNOWN').length;
  const unbound = rows.filter((r) => !r.bound).length;

  const mix = [
    { label: t('reports.devices.online'), value: online, color: chart.moving },
    { label: t('reports.devices.offline'), value: offline, color: chart.offline },
    { label: t('reports.devices.stale'), value: stale, color: chart.idle },
    { label: t('reports.devices.unknown'), value: unknown, color: chart.noTelemetry },
  ].filter((s) => s.value > 0);

  const donutOptions = useMemo<ApexOptions>(
    () => ({
      labels: mix.map((s) => s.label),
      colors: mix.map((s) => s.color),
      legend: { position: 'bottom' },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: { show: true, total: { show: true, label: t('reports.sections.devices') } },
          },
        },
      },
    }),
    [mix, t],
  );

  const columns: Column<DeviceReportRow>[] = [
    { id: 'imei', headerKey: 'reports.cols.imei', render: (r) => r.imei },
    { id: 'model', headerKey: 'reports.cols.model', render: (r) => r.model },
    {
      id: 'vehicle',
      headerKey: 'reports.cols.vehicle',
      render: (r) => (r.bound ? r.vehicleLabel : t('reports.devices.unbound')),
    },
    {
      id: 'presence',
      headerKey: 'reports.cols.presence',
      render: (r) => (
        <Badge color={PRESENCE_TONE[r.presence]}>
          {t(`reports.devices.${r.presence.toLowerCase()}`, { defaultValue: r.presence })}
        </Badge>
      ),
    },
    {
      id: 'lastSeen',
      headerKey: 'reports.cols.lastSeen',
      render: (r) =>
        r.lastSeenAt
          ? `${formatDateTime(r.lastSeenAt)} · ${lastSeenLabel(r.lastSeenAt, t)}`
          : lastSeenLabel(null, t),
    },
    { id: 'status', headerKey: 'reports.cols.status', render: (r) => r.status },
  ];

  if (devices.isLoading || statuses.isLoading) {
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

  if (devices.isError) {
    return <ErrorState error={devices.error} onRetry={() => devices.refetch()} />;
  }
  if (statuses.isError) {
    return <ErrorState error={statuses.error} onRetry={() => statuses.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="report-devices">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiTile
          labelKey="reports.sections.devices"
          value={rows.length}
          icon={Radio}
          tone="brand"
        />
        <KpiTile labelKey="reports.devices.online" value={online} icon={Wifi} tone="success" />
        <KpiTile labelKey="reports.devices.offline" value={offline} icon={WifiOff} tone="danger" />
        <KpiTile labelKey="reports.devices.stale" value={stale} icon={Radio} tone="warning" />
        <KpiTile labelKey="reports.devices.unbound" value={unbound} icon={Link2Off} tone="gray" />
      </div>

      <Card>
        <CardHeader title={t('reports.charts.devicePresence')} />
        {mix.length === 0 ? (
          <EmptyChart label={t('reports.charts.empty')} />
        ) : (
          <ApexChart
            type="donut"
            series={mix.map((s) => s.value)}
            options={donutOptions}
            height={260}
          />
        )}
      </Card>

      <ReportsTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyKey="reports.empty"
        dense
      />
      <p className="text-xs text-gray-500 dark:text-graydark-600">{t('reports.devices.note')}</p>
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

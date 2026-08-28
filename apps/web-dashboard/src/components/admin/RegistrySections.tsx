/**
 * Admin registry tables for fleets, vehicles, devices, and geofences — real
 * list endpoints, with a link to the full CRUD page.
 */
import { Layers, MapPin, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDevices, useFleets, useVehicles } from '@/api/asset.api';
import { useGeofences } from '@/api/geofence.api';
import { AdminPageLink } from '@/components/admin/admin-meta';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge, DataTable, EmptyState, type TableColumn, Toolbar } from '@/components/tailwind-ui';
import type { Device, Fleet, Vehicle } from '@/types/asset.types';
import type { Geofence } from '@/types/geofence.types';

export function FleetsSection() {
  const { t } = useTranslation();
  const fleets = useFleets();
  const vehicles = useVehicles();

  const fleetCols: Array<TableColumn<Fleet>> = [
    {
      id: 'name',
      headerKey: 'admin.fleets.colName',
      sortBy: (f) => f.name,
      render: (f) => <span className="font-medium">{f.name}</span>,
    },
    { id: 'code', headerKey: 'admin.fleets.colCode', sortBy: (f) => f.code, render: (f) => f.code },
    {
      id: 'status',
      headerKey: 'admin.users.colStatus',
      render: (f) => (
        <Badge color={f.status === 'ACTIVE' ? 'success' : 'gray'} dot>
          {f.status}
        </Badge>
      ),
    },
  ];
  const vehicleCols: Array<TableColumn<Vehicle>> = [
    {
      id: 'name',
      headerKey: 'admin.fleets.colVehicle',
      sortBy: (v) => v.name,
      render: (v) => <span className="font-medium">{v.name}</span>,
    },
    { id: 'code', headerKey: 'admin.fleets.colCode', render: (v) => v.code },
    { id: 'plate', headerKey: 'admin.fleets.colPlate', render: (v) => v.plate ?? '—' },
    {
      id: 'status',
      headerKey: 'admin.users.colStatus',
      render: (v) => (
        <Badge color={v.status === 'ACTIVE' ? 'success' : 'gray'} dot>
          {v.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <Toolbar
          left={<h2 className="text-sm font-semibold">{t('admin.nav.fleets')}</h2>}
          right={<AdminPageLink to="/assets" label={t('admin.openFullPage')} />}
        />
        <DataTable
          rows={fleets.data ?? []}
          columns={fleetCols}
          rowKey={(f) => f.id}
          loading={fleets.isLoading}
          maxHeight="280px"
          errorState={
            fleets.error ? (
              <ErrorState error={fleets.error} onRetry={() => void fleets.refetch()} />
            ) : undefined
          }
          emptyState={<EmptyState icon={<Truck />} title={t('admin.empty')} />}
        />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">{t('admin.fleets.vehicles')}</h2>
        <DataTable
          rows={vehicles.data ?? []}
          columns={vehicleCols}
          rowKey={(v) => v.id}
          loading={vehicles.isLoading}
          maxHeight="320px"
          errorState={
            vehicles.error ? (
              <ErrorState error={vehicles.error} onRetry={() => void vehicles.refetch()} />
            ) : undefined
          }
          emptyState={<EmptyState title={t('admin.empty')} />}
        />
      </section>
    </div>
  );
}

export function DevicesSection() {
  const { t } = useTranslation();
  const devices = useDevices();
  const columns: Array<TableColumn<Device>> = [
    {
      id: 'imei',
      headerKey: 'admin.devices.colImei',
      sortBy: (d) => d.imei,
      render: (d) => <span className="font-mono text-xs">{d.imei}</span>,
    },
    { id: 'protocol', headerKey: 'admin.devices.colProtocol', render: (d) => d.protocol },
    {
      id: 'status',
      headerKey: 'admin.users.colStatus',
      render: (d) => (
        <Badge color={d.status === 'ACTIVE' ? 'success' : 'warning'} dot>
          {d.status}
        </Badge>
      ),
    },
    {
      id: 'vehicle',
      headerKey: 'admin.fleets.colVehicle',
      render: (d) => d.vehicleId ?? t('admin.devices.unbound'),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        left={<h2 className="text-sm font-semibold">{t('admin.nav.devices')}</h2>}
        right={<AdminPageLink to="/assets" label={t('admin.openFullPage')} />}
      />
      <DataTable
        rows={devices.data ?? []}
        columns={columns}
        rowKey={(d) => d.id}
        loading={devices.isLoading}
        maxHeight="calc(100vh - 260px)"
        errorState={
          devices.error ? (
            <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />
          ) : undefined
        }
        emptyState={
          <EmptyState
            icon={<Layers />}
            title={t('admin.empty')}
            description={t('admin.devices.empty')}
          />
        }
      />
    </div>
  );
}

export function GeofencesSection() {
  const { t } = useTranslation();
  const geofences = useGeofences();
  const columns: Array<TableColumn<Geofence>> = [
    {
      id: 'name',
      headerKey: 'admin.geofences.colName',
      sortBy: (g) => g.name,
      render: (g) => <span className="font-medium">{g.name}</span>,
    },
    { id: 'type', headerKey: 'admin.geofences.colType', render: (g) => g.type },
    {
      id: 'status',
      headerKey: 'admin.users.colStatus',
      render: (g) => (
        <Badge color={g.status === 'ACTIVE' ? 'success' : 'gray'} dot>
          {g.status}
        </Badge>
      ),
    },
    {
      id: 'alerts',
      headerKey: 'admin.geofences.colAlerts',
      render: (g) => g.alertOn.join(', ') || '—',
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        left={<h2 className="text-sm font-semibold">{t('admin.nav.geofences')}</h2>}
        right={<AdminPageLink to="/geofences" label={t('admin.openFullPage')} />}
      />
      <DataTable
        rows={geofences.data ?? []}
        columns={columns}
        rowKey={(g) => g.id}
        loading={geofences.isLoading}
        maxHeight="calc(100vh - 260px)"
        errorState={
          geofences.error ? (
            <ErrorState error={geofences.error} onRetry={() => void geofences.refetch()} />
          ) : undefined
        }
        emptyState={
          <EmptyState
            icon={<MapPin />}
            title={t('admin.empty')}
            description={t('admin.geofences.empty')}
          />
        }
      />
    </div>
  );
}

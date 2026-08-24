/**
 * VehiclesTab — the vehicle registry table (REAL fleet-management contract).
 *
 * Columns: Name · Code · Fleet (name resolved via the fleet list) · Plate ·
 * VIN · Status (ACTIVE/ARCHIVED) · Updated. Filters: fleet dropdown, status,
 * free-text search (client-side). Row click opens the vehicle detail drawer;
 * per-row actions (view / edit / archive) gated by `vehicle.write`.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AssetRowActions } from '@/components/assets/AssetRowActions';
import { vehicleStatusColor } from '@/components/assets/asset-meta';
import {
  Badge,
  DataTable,
  EmptyState,
  Select,
  type TableColumn,
  Toolbar,
} from '@/components/tailwind-ui';
import type { Fleet, Vehicle, VehicleStatus } from '@/types/asset.types';
import { Truck } from 'lucide-react';

interface VehiclesTabProps {
  vehicles: Vehicle[];
  /** Fleet registry — resolves fleetId → name + powers the fleet filter. */
  fleets: Fleet[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filterStatus: VehicleStatus | 'all';
  filterFleet: string | 'all';
  query: string;
  onFilterStatus: (s: VehicleStatus | 'all') => void;
  onFilterFleet: (f: string | 'all') => void;
  onQuery: (q: string) => void;
  /** Open the edit drawer for a vehicle. */
  onEdit?: (vehicle: Vehicle) => void;
  /** Open the archive confirmation for a vehicle. */
  onDelete?: (id: string, name: string) => void;
}

const STATUSES: Array<VehicleStatus | 'all'> = ['all', 'ACTIVE', 'ARCHIVED'];

export function VehiclesTab({
  vehicles,
  fleets,
  loading = false,
  selectedId,
  onSelect,
  filterStatus,
  filterFleet,
  query,
  onFilterStatus,
  onFilterFleet,
  onQuery,
  onEdit,
  onDelete,
}: VehiclesTabProps) {
  const { t } = useTranslation();

  const fleetName = useMemo(() => {
    const byId = new Map(fleets.map((f) => [f.id, f] as const));
    return (fleetId: string): string => byId.get(fleetId)?.name ?? '—';
  }, [fleets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (filterStatus !== 'all' && v.status !== filterStatus) return false;
      if (filterFleet !== 'all' && v.fleetId !== filterFleet) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        v.code.toLowerCase().includes(q) ||
        (v.plate?.toLowerCase().includes(q) ?? false) ||
        (v.vin?.toLowerCase().includes(q) ?? false) ||
        fleetName(v.fleetId).toLowerCase().includes(q)
      );
    });
  }, [vehicles, filterStatus, filterFleet, query, fleetName]);

  const columns: Array<TableColumn<Vehicle>> = [
    {
      id: 'name',
      headerKey: 'assets.vehicle.colName',
      sortBy: (v) => v.name,
      render: (v) => (
        <span className="font-medium text-gray-800 dark:text-graydark-800">{v.name}</span>
      ),
    },
    {
      id: 'code',
      headerKey: 'assets.vehicle.colCode',
      sortBy: (v) => v.code,
      render: (v) => <span className="font-mono text-xs">{v.code}</span>,
    },
    {
      id: 'fleet',
      headerKey: 'assets.vehicle.colFleet',
      render: (v) => fleetName(v.fleetId),
    },
    {
      id: 'plate',
      headerKey: 'assets.vehicle.colPlate',
      render: (v) => v.plate ?? <span className="text-gray-400 dark:text-graydark-600">—</span>,
    },
    {
      id: 'vin',
      headerKey: 'assets.vehicle.colVin',
      render: (v) => <span className="font-mono text-xs">{v.vin ?? '—'}</span>,
    },
    {
      id: 'status',
      headerKey: 'assets.vehicle.colStatus',
      sortBy: (v) => v.status,
      render: (v) => (
        <Badge color={vehicleStatusColor(v.status)} dot>
          {t(`assets.vehicle.status.${v.status}`)}
        </Badge>
      ),
    },
    {
      id: 'updated',
      headerKey: 'assets.vehicle.colUpdated',
      sortBy: (v) => v.updatedAt,
      render: (v) => (
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {new Date(v.updatedAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'end',
      render: (v) => (
        <AssetRowActions
          record={v}
          writePermission="vehicle.write"
          onView={(vehicle) => onSelect(vehicle.id)}
          onEdit={onEdit}
          onDelete={onDelete ? (vehicle) => onDelete(vehicle.id, vehicle.name) : undefined}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        search
        searchValue={query}
        onSearchChange={onQuery}
        searchPlaceholder={t('assets.vehicle.search')}
        left={
          <>
            <Select
              value={filterFleet}
              onChange={(e) => onFilterFleet(e.target.value as string | 'all')}
              wrapperClassName="w-44"
              aria-label={t('assets.filters.allFleets')}
              options={[
                { value: 'all', label: t('assets.filters.allFleets') },
                ...fleets.map((f) => ({ value: f.id, label: f.name })),
              ]}
            />
            <Select
              value={filterStatus}
              onChange={(e) => onFilterStatus(e.target.value as VehicleStatus | 'all')}
              wrapperClassName="w-36"
              aria-label={t('assets.vehicle.colStatus')}
              options={STATUSES.map((s) => ({
                value: s,
                label:
                  s === 'all' ? t('assets.filters.allStatus') : t(`assets.vehicle.status.${s}`),
              }))}
            />
          </>
        }
        right={
          <span className="text-xs text-gray-500 dark:text-graydark-600">
            {t('assets.count', { count: filtered.length })}
          </span>
        }
      />
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(v) => v.id}
        loading={loading}
        selectedKey={selectedId}
        onRowClick={(v) => onSelect(v.id)}
        maxHeight="calc(100vh - 320px)"
        emptyState={
          <EmptyState
            icon={<Truck />}
            title={t('assets.empty')}
            description={t('assets.vehicle.emptyDescription')}
          />
        }
      />
    </div>
  );
}

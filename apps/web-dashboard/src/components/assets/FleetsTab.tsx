/**
 * FleetsTab — the fleet registry table (REAL fleet-management contract).
 *
 * Columns: Name · Code · Status · Vehicles (count resolved from the vehicle
 * list) · Description · Updated. Filterable by status + free-text search
 * (client-side). Row click opens the fleet detail drawer; per-row actions
 * (view / edit / archive) gated by `fleet.write`.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AssetRowActions } from '@/components/assets/AssetRowActions';
import { fleetStatusColor } from '@/components/assets/asset-meta';
import {
  Badge,
  DataTable,
  EmptyState,
  Select,
  type TableColumn,
  Toolbar,
} from '@/components/tailwind-ui';
import type { Fleet, FleetStatus, Vehicle } from '@/types/asset.types';
import { FolderTree } from 'lucide-react';

interface FleetsTabProps {
  fleets: Fleet[];
  /** Vehicle registry — used for the cheap vehicles-per-fleet count. */
  vehicles: Vehicle[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filterStatus: FleetStatus | 'all';
  query: string;
  onFilterStatus: (s: FleetStatus | 'all') => void;
  onQuery: (q: string) => void;
  /** Open the edit drawer for a fleet. */
  onEdit?: (fleet: Fleet) => void;
  /** Open the archive confirmation for a fleet. */
  onDelete?: (id: string, name: string) => void;
}

const STATUSES: Array<FleetStatus | 'all'> = ['all', 'ACTIVE', 'ARCHIVED'];

export function FleetsTab({
  fleets,
  vehicles,
  loading = false,
  selectedId,
  onSelect,
  filterStatus,
  query,
  onFilterStatus,
  onQuery,
  onEdit,
  onDelete,
}: FleetsTabProps) {
  const { t } = useTranslation();

  // Vehicles-per-fleet counts (cheap: one pass over the already-loaded list).
  const vehicleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehicles) counts.set(v.fleetId, (counts.get(v.fleetId) ?? 0) + 1);
    return counts;
  }, [vehicles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fleets.filter((f) => {
      if (filterStatus !== 'all' && f.status !== filterStatus) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.code.toLowerCase().includes(q) ||
        (f.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [fleets, filterStatus, query]);

  const columns: Array<TableColumn<Fleet>> = [
    {
      id: 'name',
      headerKey: 'assets.fleet.colName',
      sortBy: (f) => f.name,
      render: (f) => (
        <span className="font-medium text-gray-800 dark:text-graydark-800">{f.name}</span>
      ),
    },
    {
      id: 'code',
      headerKey: 'assets.fleet.colCode',
      sortBy: (f) => f.code,
      render: (f) => <span className="font-mono text-xs">{f.code}</span>,
    },
    {
      id: 'status',
      headerKey: 'assets.fleet.colStatus',
      sortBy: (f) => f.status,
      render: (f) => (
        <Badge color={fleetStatusColor(f.status)} dot>
          {t(`assets.fleet.status.${f.status}`)}
        </Badge>
      ),
    },
    {
      id: 'vehicles',
      headerKey: 'assets.fleet.colVehicles',
      align: 'end',
      sortBy: (f) => vehicleCounts.get(f.id) ?? 0,
      render: (f) => (
        <span className="tabular-nums text-gray-500 dark:text-graydark-600">
          {vehicleCounts.get(f.id) ?? 0}
        </span>
      ),
    },
    {
      id: 'description',
      headerKey: 'assets.fleet.description',
      nowrap: false,
      render: (f) => (
        <span className="text-gray-500 dark:text-graydark-600">{f.description ?? '—'}</span>
      ),
    },
    {
      id: 'updated',
      headerKey: 'assets.fleet.colUpdated',
      sortBy: (f) => f.updatedAt,
      render: (f) => (
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {new Date(f.updatedAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'end',
      render: (f) => (
        <AssetRowActions
          record={f}
          writePermission="fleet.write"
          onView={(fleet) => onSelect(fleet.id)}
          onEdit={onEdit}
          onDelete={onDelete ? (fleet) => onDelete(fleet.id, fleet.name) : undefined}
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
        searchPlaceholder={t('assets.fleet.search')}
        left={
          <Select
            value={filterStatus}
            onChange={(e) => onFilterStatus(e.target.value as FleetStatus | 'all')}
            wrapperClassName="w-36"
            aria-label={t('assets.fleet.colStatus')}
            options={STATUSES.map((s) => ({
              value: s,
              label: s === 'all' ? t('assets.filters.allStatus') : t(`assets.fleet.status.${s}`),
            }))}
          />
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
        rowKey={(f) => f.id}
        loading={loading}
        selectedKey={selectedId}
        onRowClick={(f) => onSelect(f.id)}
        maxHeight="calc(100vh - 320px)"
        emptyState={
          <EmptyState
            icon={<FolderTree />}
            title={t('assets.empty')}
            description={t('assets.fleet.search')}
          />
        }
      />
    </div>
  );
}

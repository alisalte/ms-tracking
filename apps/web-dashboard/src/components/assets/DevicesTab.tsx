/**
 * DevicesTab — the telematics device registry table (REAL fleet-management
 * contract, Sprint E §10).
 *
 * Columns: IMEI (mono) · Serial · Manufacturer · Model · Protocol (badge) ·
 * Status (lifecycle badge) · Vehicle (resolved via vehicleId, '—' when
 * unbound) · Last Seen (relative from lastSeenAt, 'never' when null).
 * Filters: status, protocol, free-text search. Row click opens the device
 * detail drawer; per-row actions (view / edit / decommission) gated by
 * `device.write`.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AssetRowActions } from '@/components/assets/AssetRowActions';
import { deviceProtocolColor, deviceStatusColor } from '@/components/assets/asset-meta';
import {
  Badge,
  DataTable,
  EmptyState,
  Select,
  type TableColumn,
  Toolbar,
} from '@/components/tailwind-ui';
import type { Device, DeviceProtocol, DeviceStatus, Vehicle } from '@/types/asset.types';
import { Cpu } from 'lucide-react';

interface DevicesTabProps {
  devices: Device[];
  /** Vehicle registry — resolves device.vehicleId → vehicle name. */
  vehicles: Vehicle[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filterStatus: DeviceStatus | 'all';
  filterProtocol: DeviceProtocol | 'all';
  query: string;
  onFilterStatus: (s: DeviceStatus | 'all') => void;
  onFilterProtocol: (p: DeviceProtocol | 'all') => void;
  onQuery: (q: string) => void;
  /** Open the edit drawer for a device. */
  onEdit?: (device: Device) => void;
  /** Open the decommission confirmation for a device. */
  onDelete?: (id: string, name: string) => void;
}

const STATUSES: Array<DeviceStatus | 'all'> = [
  'all',
  'ACTIVE',
  'SUSPENDED',
  'UNPAIRED',
  'DECOMMISSIONED',
];
const PROTOCOLS: Array<DeviceProtocol | 'all'> = ['all', 'gt06', 'jt808', 'meitrack', 'stub'];

export function DevicesTab({
  devices,
  vehicles,
  loading = false,
  selectedId,
  onSelect,
  filterStatus,
  filterProtocol,
  query,
  onFilterStatus,
  onFilterProtocol,
  onQuery,
  onEdit,
  onDelete,
}: DevicesTabProps) {
  const { t } = useTranslation();

  const vehicleName = useMemo(() => {
    const byId = new Map(vehicles.map((v) => [v.id, v] as const));
    return (vehicleId: string | null): string =>
      vehicleId ? (byId.get(vehicleId)?.name ?? '—') : '—';
  }, [vehicles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (filterStatus !== 'all' && d.status !== filterStatus) return false;
      if (filterProtocol !== 'all' && d.protocol !== filterProtocol) return false;
      if (!q) return true;
      return (
        d.imei.toLowerCase().includes(q) ||
        (d.serialNumber?.toLowerCase().includes(q) ?? false) ||
        (d.manufacturer?.toLowerCase().includes(q) ?? false) ||
        (d.model?.toLowerCase().includes(q) ?? false) ||
        vehicleName(d.vehicleId).toLowerCase().includes(q)
      );
    });
  }, [devices, filterStatus, filterProtocol, query, vehicleName]);

  const columns: Array<TableColumn<Device>> = [
    {
      id: 'imei',
      headerKey: 'assets.device.colImei',
      sortBy: (d) => d.imei,
      render: (d) => <span className="font-mono text-xs font-medium">{d.imei}</span>,
    },
    {
      id: 'serial',
      headerKey: 'assets.device.colSerial',
      render: (d) => <span className="font-mono text-xs">{d.serialNumber ?? '—'}</span>,
    },
    {
      id: 'manufacturer',
      headerKey: 'assets.device.colManufacturer',
      render: (d) => d.manufacturer ?? '—',
    },
    {
      id: 'model',
      headerKey: 'assets.device.colModel',
      render: (d) => d.model ?? '—',
    },
    {
      id: 'protocol',
      headerKey: 'assets.device.colProtocol',
      sortBy: (d) => d.protocol,
      render: (d) => (
        <Badge color={deviceProtocolColor(d.protocol)} dot>
          {t(`assets.device.protocols.${d.protocol}`)}
        </Badge>
      ),
    },
    {
      id: 'status',
      headerKey: 'assets.device.colStatus',
      sortBy: (d) => d.status,
      render: (d) => (
        <Badge color={deviceStatusColor(d.status)} dot>
          {t(`assets.device.statusValues.${d.status}`)}
        </Badge>
      ),
    },
    {
      id: 'vehicle',
      headerKey: 'assets.device.colVehicle',
      render: (d) => (d.vehicleId ? vehicleName(d.vehicleId) : '—'),
    },
    {
      id: 'lastSeen',
      headerKey: 'assets.device.colLastSeen',
      sortBy: (d) => d.lastSeenAt ?? '',
      render: (d) => (
        <span
          className="text-xs text-gray-500 dark:text-graydark-600"
          title={d.lastSeenAt ?? undefined}
        >
          {d.lastSeenAt ? relTime(d.lastSeenAt) : t('assets.device.never')}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'end',
      render: (d) => (
        <AssetRowActions
          record={d}
          writePermission="device.write"
          deleteIcon="decommission"
          onView={(device) => onSelect(device.id)}
          onEdit={onEdit}
          onDelete={onDelete ? (device) => onDelete(device.id, device.imei) : undefined}
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
        searchPlaceholder={t('assets.device.search')}
        left={
          <>
            <Select
              value={filterStatus}
              onChange={(e) => onFilterStatus(e.target.value as DeviceStatus | 'all')}
              wrapperClassName="w-40"
              aria-label={t('assets.device.colStatus')}
              options={STATUSES.map((s) => ({
                value: s,
                label:
                  s === 'all'
                    ? t('assets.filters.allStatus')
                    : t(`assets.device.statusValues.${s}`),
              }))}
            />
            <Select
              value={filterProtocol}
              onChange={(e) => onFilterProtocol(e.target.value as DeviceProtocol | 'all')}
              wrapperClassName="w-36"
              aria-label={t('assets.device.colProtocol')}
              options={PROTOCOLS.map((p) => ({
                value: p,
                label: p === 'all' ? t('common.all') : t(`assets.device.protocols.${p}`),
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
        rowKey={(d) => d.id}
        loading={loading}
        selectedKey={selectedId}
        onRowClick={(d) => onSelect(d.id)}
        maxHeight="calc(100vh - 320px)"
        emptyState={
          <EmptyState
            icon={<Cpu />}
            title={t('assets.empty')}
            description={t('assets.device.search')}
          />
        }
      />
    </div>
  );
}

/** Compact relative time for the Last-seen column ("now" / "5m" / "3h" / "2d"). */
export function relTime(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / (60 * 24))}d`;
}

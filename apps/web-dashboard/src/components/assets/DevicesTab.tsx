/**
 * DevicesTab — the telematics device registry table (REAL fleet-management
 * contract, Sprint E §10).
 *
 * Columns: IMEI (mono) · Serial · Manufacturer · Model · Protocol (badge) ·
 * Status (lifecycle badge) · Vehicle (resolved via vehicleId, '—' when
 * unbound) · Last Seen (relative from lastSeenAt, 'never' when null).
 * Filters: status, protocol, free-text search. Row click opens the device
 * detail drawer; per-row menu offers Edit / Decommission gated by
 * `device.write`.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { deviceProtocolColor, deviceStatusColor } from '@/components/assets/asset-meta';
import { PermissionGate } from '@/auth/permissions';
import { DataTable, EmptyState, StatusBadge, Toolbar, type Column } from '@/components/ui';
import type { Device, DeviceProtocol, DeviceStatus, Vehicle } from '@/types/asset.types';
import { Box, IconButton, ListItemIcon, Menu, MenuItem, Select, Typography } from '@mui/material';
import { CircleSlash, Eye, MoreVertical, Pencil } from 'lucide-react';

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
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuDevice, setMenuDevice] = useState<Device | null>(null);
  const openMenu = (e: React.MouseEvent<HTMLElement>, d: Device) => {
    setMenuDevice(d);
    setMenuAnchor(e.currentTarget);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuDevice(null);
  };

  const vehicleName = useMemo(() => {
    const byId = new Map(vehicles.map((v) => [v.id, v] as const));
    return (vehicleId: string | null): string => (vehicleId ? byId.get(vehicleId)?.name ?? '—' : '—');
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

  const columns: Array<Column<Device>> = [
    {
      id: 'imei',
      headerKey: 'assets.device.colImei',
      render: (d) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }} noWrap>
          {d.imei}
        </Typography>
      ),
    },
    {
      id: 'serial',
      headerKey: 'assets.device.colSerial',
      render: (d) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }} noWrap>
          {d.serialNumber ?? '—'}
        </Typography>
      ),
    },
    {
      id: 'manufacturer',
      headerKey: 'assets.device.colManufacturer',
      render: (d) => (
        <Typography variant="body2" noWrap>
          {d.manufacturer ?? '—'}
        </Typography>
      ),
    },
    {
      id: 'model',
      headerKey: 'assets.device.colModel',
      render: (d) => (
        <Typography variant="body2" noWrap>
          {d.model ?? '—'}
        </Typography>
      ),
    },
    {
      id: 'protocol',
      headerKey: 'assets.device.colProtocol',
      render: (d) => (
        <StatusBadge
          label={t(`assets.device.protocols.${d.protocol}`)}
          color={deviceProtocolColor(d.protocol)}
        />
      ),
    },
    {
      id: 'status',
      headerKey: 'assets.device.colStatus',
      render: (d) => (
        <StatusBadge
          label={t(`assets.device.statusValues.${d.status}`)}
          color={deviceStatusColor(d.status)}
          variant="solid"
        />
      ),
    },
    {
      id: 'vehicle',
      headerKey: 'assets.device.colVehicle',
      render: (d) => (
        <Typography variant="body2" noWrap>
          {d.vehicleId ? vehicleName(d.vehicleId) : '—'}
        </Typography>
      ),
    },
    {
      id: 'lastSeen',
      headerKey: 'assets.device.colLastSeen',
      render: (d) => (
        <Typography variant="caption" color="text.secondary" noWrap title={d.lastSeenAt ?? undefined}>
          {d.lastSeenAt ? relTime(d.lastSeenAt) : t('assets.device.never')}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (d) => (
        <IconButton
          size="small"
          aria-label={t('common.actions')}
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e, d);
          }}
        >
          <MoreVertical size={18} />
        </IconButton>
      ),
    },
  ];

  return (
    <Box>
      <Toolbar
        search
        searchValue={query}
        onSearchChange={onQuery}
        searchPlaceholderKey="assets.device.search"
        left={
          <>
            <Select
              size="small"
              value={filterStatus}
              onChange={(e) => onFilterStatus(e.target.value as DeviceStatus | 'all')}
              sx={{ height: 32, minWidth: 140, fontSize: '0.8rem' }}
            >
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s === 'all' ? t('assets.filters.allStatus') : t(`assets.device.statusValues.${s}`)}
                </MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              value={filterProtocol}
              onChange={(e) => onFilterProtocol(e.target.value as DeviceProtocol | 'all')}
              sx={{ height: 32, minWidth: 130, fontSize: '0.8rem' }}
            >
              {PROTOCOLS.map((p) => (
                <MenuItem key={p} value={p}>
                  {p === 'all' ? t('assets.filters.allProtocols') : t(`assets.device.protocols.${p}`)}
                </MenuItem>
              ))}
            </Select>
          </>
        }
        right={
          <Typography variant="caption" color="text.secondary">
            {t('assets.count', { count: filtered.length })}
          </Typography>
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
            icon={CircleSlash}
            title={t('assets.empty')}
            description={t('assets.device.search')}
          />
        }
      />

      {/* Per-row action menu — Edit/Decommission gated by device.write. */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        <MenuItem
          onClick={() => {
            if (menuDevice) onSelect(menuDevice.id);
            closeMenu();
          }}
        >
          <ListItemIcon>
            <Eye size={16} />
          </ListItemIcon>
          <Typography variant="body2">{t('common.view')}</Typography>
        </MenuItem>
        <PermissionGate requires="device.write">
          <MenuItem
            onClick={() => {
              if (menuDevice && onEdit) onEdit(menuDevice);
              closeMenu();
            }}
            disabled={!onEdit}
          >
            <ListItemIcon>
              <Pencil size={16} />
            </ListItemIcon>
            <Typography variant="body2">{t('common.edit')}</Typography>
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (menuDevice && onDelete) onDelete(menuDevice.id, menuDevice.imei);
              closeMenu();
            }}
            disabled={!onDelete}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon>
              <CircleSlash size={16} />
            </ListItemIcon>
            <Typography variant="body2">{t('assets.actions.decommission')}</Typography>
          </MenuItem>
        </PermissionGate>
      </Menu>
    </Box>
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

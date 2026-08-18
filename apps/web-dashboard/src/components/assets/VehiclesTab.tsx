/**
 * VehiclesTab — the vehicle registry table (REAL fleet-management contract).
 *
 * Columns: Name · Code · Fleet (name resolved via the fleet list) · Plate ·
 * VIN · Status (ACTIVE/ARCHIVED) · Updated. Filters: fleet dropdown, status,
 * free-text search (client-side). Row click opens the vehicle detail drawer;
 * per-row menu offers Edit / Archive gated by `vehicle.write`.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PermissionGate } from '@/auth/permissions';
import { vehicleStatusColor } from '@/components/assets/asset-meta';
import { type Column, DataTable, EmptyState, StatusBadge, Toolbar } from '@/components/ui';
import type { Fleet, Vehicle, VehicleStatus } from '@/types/asset.types';
import { Box, IconButton, ListItemIcon, Menu, MenuItem, Select, Typography } from '@mui/material';
import { Archive, Eye, MoreVertical, Pencil, Truck } from 'lucide-react';

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
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuVehicle, setMenuVehicle] = useState<Vehicle | null>(null);
  const openMenu = (e: React.MouseEvent<HTMLElement>, v: Vehicle) => {
    setMenuVehicle(v);
    setMenuAnchor(e.currentTarget);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuVehicle(null);
  };

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

  const columns: Array<Column<Vehicle>> = [
    {
      id: 'name',
      headerKey: 'assets.vehicle.colName',
      render: (v) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
          {v.name}
        </Typography>
      ),
    },
    {
      id: 'code',
      headerKey: 'assets.vehicle.colCode',
      render: (v) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }} noWrap>
          {v.code}
        </Typography>
      ),
    },
    {
      id: 'fleet',
      headerKey: 'assets.vehicle.colFleet',
      render: (v) => (
        <Typography variant="body2" noWrap>
          {fleetName(v.fleetId)}
        </Typography>
      ),
    },
    {
      id: 'plate',
      headerKey: 'assets.vehicle.colPlate',
      render: (v) =>
        v.plate ? (
          <Typography variant="body2" noWrap>
            {v.plate}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            —
          </Typography>
        ),
    },
    {
      id: 'vin',
      headerKey: 'assets.vehicle.colVin',
      render: (v) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }} noWrap>
          {v.vin ?? '—'}
        </Typography>
      ),
    },
    {
      id: 'status',
      headerKey: 'assets.vehicle.colStatus',
      render: (v) => (
        <StatusBadge
          label={t(`assets.vehicle.status.${v.status}`)}
          color={vehicleStatusColor(v.status)}
          variant="solid"
        />
      ),
    },
    {
      id: 'updated',
      headerKey: 'assets.vehicle.colUpdated',
      render: (v) => (
        <Typography variant="caption" color="text.secondary">
          {new Date(v.updatedAt).toLocaleDateString()}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (v) => (
        <IconButton
          size="small"
          aria-label={t('common.actions')}
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e, v);
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
        searchPlaceholderKey="assets.vehicle.search"
        left={
          <>
            <Select
              size="small"
              value={filterFleet}
              onChange={(e) => onFilterFleet(e.target.value as string | 'all')}
              sx={{ height: 32, minWidth: 150, fontSize: '0.8rem' }}
            >
              <MenuItem value="all">{t('assets.filters.allFleets')}</MenuItem>
              {fleets.map((f) => (
                <MenuItem key={f.id} value={f.id}>
                  {f.name}
                </MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              value={filterStatus}
              onChange={(e) => onFilterStatus(e.target.value as VehicleStatus | 'all')}
              sx={{ height: 32, minWidth: 130, fontSize: '0.8rem' }}
            >
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s === 'all' ? t('assets.filters.allStatus') : t(`assets.vehicle.status.${s}`)}
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
        rowKey={(v) => v.id}
        loading={loading}
        selectedKey={selectedId}
        onRowClick={(v) => onSelect(v.id)}
        maxHeight="calc(100vh - 320px)"
        emptyState={
          <EmptyState
            icon={Truck}
            title={t('assets.empty')}
            description={t('assets.vehicle.search')}
          />
        }
      />

      {/* Per-row action menu — Edit/Archive gated by vehicle.write. */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        <MenuItem
          onClick={() => {
            if (menuVehicle) onSelect(menuVehicle.id);
            closeMenu();
          }}
        >
          <ListItemIcon>
            <Eye size={16} />
          </ListItemIcon>
          <Typography variant="body2">{t('common.view')}</Typography>
        </MenuItem>
        <PermissionGate requires="vehicle.write">
          <MenuItem
            onClick={() => {
              if (menuVehicle && onEdit) onEdit(menuVehicle);
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
              if (menuVehicle && onDelete) onDelete(menuVehicle.id, menuVehicle.name);
              closeMenu();
            }}
            disabled={!onDelete}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon>
              <Archive size={16} />
            </ListItemIcon>
            <Typography variant="body2">{t('assets.actions.archive')}</Typography>
          </MenuItem>
        </PermissionGate>
      </Menu>
    </Box>
  );
}

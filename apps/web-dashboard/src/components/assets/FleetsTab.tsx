/**
 * FleetsTab — the fleet registry table (REAL fleet-management contract).
 *
 * Columns: Name · Code · Status · Vehicles (count resolved from the vehicle
 * list) · Description · Updated. Filterable by status + free-text search
 * (client-side). Row click opens the fleet detail drawer; per-row menu offers
 * Edit / Archive gated by `fleet.write` (archive = the backend's soft DELETE).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fleetStatusColor } from '@/components/assets/asset-meta';
import { DataTable, EmptyState, StatusBadge, Toolbar, type Column } from '@/components/ui';
import { PermissionGate } from '@/auth/permissions';
import type { Fleet, FleetStatus, Vehicle } from '@/types/asset.types';
import { Box, IconButton, ListItemIcon, Menu, MenuItem, Select, Typography } from '@mui/material';
import { Archive, Eye, FolderTree, MoreVertical, Pencil } from 'lucide-react';

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
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuFleet, setMenuFleet] = useState<Fleet | null>(null);
  const openMenu = (e: React.MouseEvent<HTMLElement>, f: Fleet) => {
    setMenuFleet(f);
    setMenuAnchor(e.currentTarget);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuFleet(null);
  };

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

  const columns: Array<Column<Fleet>> = [
    {
      id: 'name',
      headerKey: 'assets.fleet.colName',
      render: (f) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
          {f.name}
        </Typography>
      ),
    },
    {
      id: 'code',
      headerKey: 'assets.fleet.colCode',
      render: (f) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }} noWrap>
          {f.code}
        </Typography>
      ),
    },
    {
      id: 'status',
      headerKey: 'assets.fleet.colStatus',
      render: (f) => (
        <StatusBadge
          label={t(`assets.fleet.status.${f.status}`)}
          color={fleetStatusColor(f.status)}
          variant="solid"
        />
      ),
    },
    {
      id: 'vehicles',
      headerKey: 'assets.fleet.colVehicles',
      align: 'right',
      render: (f) => (
        <Typography variant="body2" color="text.secondary">
          {vehicleCounts.get(f.id) ?? 0}
        </Typography>
      ),
    },
    {
      id: 'description',
      headerKey: 'assets.fleet.description',
      nowrap: false,
      render: (f) => (
        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 280 }}>
          {f.description ?? '—'}
        </Typography>
      ),
    },
    {
      id: 'updated',
      headerKey: 'assets.fleet.colUpdated',
      render: (f) => (
        <Typography variant="caption" color="text.secondary">
          {new Date(f.updatedAt).toLocaleDateString()}
        </Typography>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (f) => (
        <IconButton
          size="small"
          aria-label={t('common.actions')}
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e, f);
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
        searchPlaceholderKey="assets.fleet.search"
        left={
          <Select
            size="small"
            value={filterStatus}
            onChange={(e) => onFilterStatus(e.target.value as FleetStatus | 'all')}
            sx={{ height: 32, minWidth: 130, fontSize: '0.8rem' }}
          >
            {STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {s === 'all' ? t('assets.filters.allStatus') : t(`assets.fleet.status.${s}`)}
              </MenuItem>
            ))}
          </Select>
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
        rowKey={(f) => f.id}
        loading={loading}
        selectedKey={selectedId}
        onRowClick={(f) => onSelect(f.id)}
        maxHeight="calc(100vh - 320px)"
        emptyState={
          <EmptyState
            icon={FolderTree}
            title={t('assets.empty')}
            description={t('assets.fleet.search')}
          />
        }
      />

      {/* Per-row action menu — Edit/Archive gated by fleet.write. */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        <MenuItem
          onClick={() => {
            if (menuFleet) onSelect(menuFleet.id);
            closeMenu();
          }}
        >
          <ListItemIcon>
            <Eye size={16} />
          </ListItemIcon>
          <Typography variant="body2">{t('common.view')}</Typography>
        </MenuItem>
        <PermissionGate requires="fleet.write">
          <MenuItem
            onClick={() => {
              if (menuFleet && onEdit) onEdit(menuFleet);
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
              if (menuFleet && onDelete) onDelete(menuFleet.id, menuFleet.name);
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

/**
 * DriversTab — the driver registry table.
 *
 * Filterable by status + free-text search. Shows the behavior score (0–100,
 * Driver-Management §2) and license-expiry warning. Row click opens the driver
 * detail drawer.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonRows } from '@/components/assets/VehiclesTab';
import { driverStatusColor } from '@/components/assets/asset-meta';
import { StatusBadge, Toolbar } from '@/components/ui';
import type { Driver, DriverStatus } from '@/types/asset.types';
import {
  Box,
  IconButton,
  LinearProgress,
  ListItemIcon,
  Menu,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Eye, MoreVertical, Pencil, Trash2 } from 'lucide-react';

interface DriversTabProps {
  drivers: Driver[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filterStatus: DriverStatus | 'all';
  query: string;
  onFilterStatus: (s: DriverStatus | 'all') => void;
  onQuery: (q: string) => void;
  onEdit?: (driver: Driver) => void;
  onDelete?: (id: string, name: string) => void;
}

const STATUSES: Array<DriverStatus | 'all'> = [
  'all',
  'active',
  'inactive',
  'suspended',
  'terminated',
];

/** Behavior-score → color (green ≥ 80, amber ≥ 65, red below). */
function scoreColor(score: number): string {
  if (score >= 80) return '#16A34A';
  if (score >= 65) return '#F59E0B';
  return '#DC2626';
}

export function DriversTab({
  drivers,
  loading = false,
  selectedId,
  onSelect,
  filterStatus,
  query,
  onFilterStatus,
  onQuery,
  onEdit,
  onDelete,
}: DriversTabProps) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuDriver, setMenuDriver] = useState<Driver | null>(null);
  const openMenu = (e: React.MouseEvent<HTMLElement>, d: Driver) => {
    setMenuDriver(d);
    setMenuAnchor(e.currentTarget);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuDriver(null);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drivers.filter((d) => {
      if (filterStatus !== 'all' && d.status !== filterStatus) return false;
      if (!q) return true;
      return (
        `${d.firstName} ${d.lastName}`.toLowerCase().includes(q) ||
        d.email.toLowerCase().includes(q) ||
        d.licenseNumber.toLowerCase().includes(q)
      );
    });
  }, [drivers, filterStatus, query]);

  if (loading) return <SkeletonRows cols={5} />;

  return (
    <Box>
      <Toolbar
        search
        searchValue={query}
        onSearchChange={onQuery}
        searchPlaceholderKey="assets.driver.search"
        left={
          <Select
            size="small"
            value={filterStatus}
            onChange={(e) => onFilterStatus(e.target.value as DriverStatus | 'all')}
            sx={{ height: 32, minWidth: 130, fontSize: '0.8rem' }}
          >
            {STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {s === 'all' ? t('assets.filters.allStatus') : t(`assets.driver.status.${s}`)}
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
      <TableContainer sx={{ maxHeight: 'calc(100vh - 280px)' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t('assets.driver.colName')}</TableCell>
              <TableCell>{t('assets.driver.colLicense')}</TableCell>
              <TableCell>{t('assets.driver.colStatus')}</TableCell>
              <TableCell>{t('assets.driver.colScore')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((d) => {
              const expiringSoon =
                new Date(d.licenseExpiry).getTime() - Date.now() < 30 * 86_400_000;
              return (
                <TableRow
                  key={d.id}
                  hover
                  selected={d.id === selectedId}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell onClick={() => onSelect(d.id)}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {d.firstName} {d.lastName}
                    </Typography>
                    {d.assignedVehicleLabel && (
                      <Typography variant="caption" color="text.secondary">
                        {d.assignedVehicleLabel}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell onClick={() => onSelect(d.id)}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {d.licenseClass} · {d.licenseNumber}
                    </Typography>
                    <Typography variant="caption" color={expiringSoon ? 'error' : 'text.secondary'}>
                      {t('assets.driver.licenseExpiry')}:{' '}
                      {new Date(d.licenseExpiry).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell onClick={() => onSelect(d.id)}>
                    <StatusBadge
                      label={t(`assets.driver.status.${d.status}`)}
                      color={driverStatusColor(d.status)}
                      variant="solid"
                    />
                  </TableCell>
                  <TableCell onClick={() => onSelect(d.id)}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 100 }}>
                      <LinearProgress
                        variant="determinate"
                        value={d.behaviorScore}
                        sx={{
                          flex: 1,
                          height: 6,
                          borderRadius: 3,
                          '& .MuiLinearProgress-bar': { bgcolor: scoreColor(d.behaviorScore) },
                        }}
                      />
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 600, color: scoreColor(d.behaviorScore) }}
                      >
                        {d.behaviorScore}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ pr: 1 }}>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); openMenu(e, d); }} aria-label={t('common.actions')}>
                      <MoreVertical size={18} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    {t('assets.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Per-row action menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        <MenuItem onClick={() => { if (menuDriver) onSelect(menuDriver.id); closeMenu(); }}>
          <ListItemIcon><Eye size={16} /></ListItemIcon>
          <Typography variant="body2">{t('common.view')}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => { if (menuDriver && onEdit) onEdit(menuDriver); closeMenu(); }}
          disabled={!onEdit}
        >
          <ListItemIcon><Pencil size={16} /></ListItemIcon>
          <Typography variant="body2">{t('common.edit')}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuDriver && onDelete) onDelete(menuDriver.id, `${menuDriver.firstName} ${menuDriver.lastName}`);
            closeMenu();
          }}
          disabled={!onDelete}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon><Trash2 size={16} /></ListItemIcon>
          <Typography variant="body2">{t('common.delete')}</Typography>
        </MenuItem>
      </Menu>
    </Box>
  );
}

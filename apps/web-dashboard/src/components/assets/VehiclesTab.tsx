/**
 * VehiclesTab — the vehicle registry table.
 *
 * Filterable by status/type + free-text search. Row click opens the vehicle
 * detail drawer (selection → detail, UI_UX §0.6). Renders the lifecycle status
 * as a colored chip (Fleet-Management §2 VehicleStatus).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { vehicleStatusColor } from '@/components/assets/asset-meta';
import type { VehicleStatus } from '@/types/asset.types';
import type { VehicleType } from '@/types/fleet.types';
import {
  Box,
  Chip,
  MenuItem,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

interface VehiclesTabProps {
  vehicles: import('@/types/asset.types').Vehicle[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filterStatus: VehicleStatus | 'all';
  filterType: VehicleType | 'all';
  query: string;
  onFilterStatus: (s: VehicleStatus | 'all') => void;
  onFilterType: (t: VehicleType | 'all') => void;
  onQuery: (q: string) => void;
}

const STATUSES: Array<VehicleStatus | 'all'> = [
  'all',
  'active',
  'maintenance',
  'inactive',
  'decommissioned',
  'sold',
];
const TYPES: Array<VehicleType | 'all'> = ['all', 'truck', 'van', 'bus', 'car'];

export function VehiclesTab({
  vehicles,
  loading = false,
  selectedId,
  onSelect,
  filterStatus,
  filterType,
  query,
  onFilterStatus,
  onFilterType,
  onQuery,
}: VehiclesTabProps) {
  const { t } = useTranslation();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (filterStatus !== 'all' && v.status !== filterStatus) return false;
      if (filterType !== 'all' && v.type !== filterType) return false;
      if (!q) return true;
      return (
        v.licensePlate.toLowerCase().includes(q) ||
        v.vin.toLowerCase().includes(q) ||
        `${v.make} ${v.model}`.toLowerCase().includes(q)
      );
    });
  }, [vehicles, filterStatus, filterType, query]);

  if (loading) {
    return <SkeletonRows cols={5} />;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, p: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
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
        <Select
          size="small"
          value={filterType}
          onChange={(e) => onFilterType(e.target.value as VehicleType | 'all')}
          sx={{ height: 32, minWidth: 110, fontSize: '0.8rem' }}
        >
          {TYPES.map((ty) => (
            <MenuItem key={ty} value={ty}>
              {ty === 'all' ? t('assets.filters.allTypes') : t(`assets.vehicle.type.${ty}`)}
            </MenuItem>
          ))}
        </Select>
        <TextField
          size="small"
          placeholder={t('assets.vehicle.search')}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          sx={{ minWidth: 220, flex: 1, maxWidth: 360 }}
        />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {t('assets.count', { count: filtered.length })}
        </Typography>
      </Box>
      <TableContainer sx={{ maxHeight: 'calc(100vh - 280px)' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t('assets.vehicle.colPlate')}</TableCell>
              <TableCell>{t('assets.vehicle.colVehicle')}</TableCell>
              <TableCell>{t('assets.vehicle.colType')}</TableCell>
              <TableCell>{t('assets.vehicle.colStatus')}</TableCell>
              <TableCell align="right">{t('assets.vehicle.colOdometer')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((v) => (
              <TableRow
                key={v.id}
                hover
                selected={v.id === selectedId}
                onClick={() => onSelect(v.id)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                    {v.licensePlate}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {v.make} {v.model}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {v.year}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{t(`assets.vehicle.type.${v.type}`)}</Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={t(`assets.vehicle.status.${v.status}`)}
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: '#fff',
                      bgcolor: vehicleStatusColor(v.status),
                    }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2">{v.odometerKm.toLocaleString()} km</Typography>
                </TableCell>
              </TableRow>
            ))}
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
    </Box>
  );
}

/** Skeleton loading rows shared by the tabs. */
export function SkeletonRows({ cols }: { cols: number }) {
  const keys = ['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e', 'sk-f', 'sk-g', 'sk-h'];
  return (
    <TableContainer>
      <Table size="small">
        <TableBody>
          {keys.map((k) => (
            <TableRow key={k}>
              <TableCell colSpan={cols}>
                <Skeleton height={26} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

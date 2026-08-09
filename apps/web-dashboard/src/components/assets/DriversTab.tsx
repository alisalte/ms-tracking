/**
 * DriversTab — the driver registry table.
 *
 * Filterable by status + free-text search. Shows the behavior score (0–100,
 * Driver-Management §2) and license-expiry warning. Row click opens the driver
 * detail drawer.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SkeletonRows } from '@/components/assets/VehiclesTab';
import { driverStatusColor } from '@/components/assets/asset-meta';
import { StatusBadge } from '@/components/ui';
import type { DriverStatus } from '@/types/asset.types';
import {
  Box,
  LinearProgress,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

interface DriversTabProps {
  drivers: import('@/types/asset.types').Driver[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filterStatus: DriverStatus | 'all';
  query: string;
  onFilterStatus: (s: DriverStatus | 'all') => void;
  onQuery: (q: string) => void;
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
}: DriversTabProps) {
  const { t } = useTranslation();

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

  if (loading) return <SkeletonRows cols={4} />;

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, p: 1.5, alignItems: 'center' }}>
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
        <TextField
          size="small"
          placeholder={t('assets.driver.search')}
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
              <TableCell>{t('assets.driver.colName')}</TableCell>
              <TableCell>{t('assets.driver.colLicense')}</TableCell>
              <TableCell>{t('assets.driver.colStatus')}</TableCell>
              <TableCell>{t('assets.driver.colScore')}</TableCell>
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
                  onClick={() => onSelect(d.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {d.firstName} {d.lastName}
                    </Typography>
                    {d.assignedVehicleLabel && (
                      <Typography variant="caption" color="text.secondary">
                        {d.assignedVehicleLabel}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {d.licenseClass} · {d.licenseNumber}
                    </Typography>
                    <Typography variant="caption" color={expiringSoon ? 'error' : 'text.secondary'}>
                      {t('assets.driver.licenseExpiry')}:{' '}
                      {new Date(d.licenseExpiry).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      label={t(`assets.driver.status.${d.status}`)}
                      color={driverStatusColor(d.status)}
                      variant="solid"
                    />
                  </TableCell>
                  <TableCell>
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
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
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

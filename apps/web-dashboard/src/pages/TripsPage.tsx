import {
  Box,
  Chip,
  InputBase,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { ArrowRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useTrips } from '@/api/fleet.api';
import type { Trip, TripStatus } from '@/types/fleet.types';

/** Status → chip color. */
const STATUS_COLOR: Record<TripStatus, 'success' | 'info' | 'default' | 'error'> = {
  completed: 'success',
  in_progress: 'info',
  planned: 'default',
  cancelled: 'error',
};

const STATUSES: TripStatus[] = ['completed', 'in_progress', 'planned', 'cancelled'];

/** Stable keys for the loading-state skeleton rows (static, never reordered). */
const SKELETON_KEYS = ['sk1', 'sk2', 'sk3', 'sk4', 'sk5', 'sk6'] as const;

/**
 * TripsPage — the fleet trip roster.
 *
 * A filterable table of trips (search by vehicle/driver + status chips). Row
 * click → trip detail with replay. Backed by `useTrips` (mock today, real
 * `GET /api/v1/trips` later).
 */
export function TripsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useTrips();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TripStatus | 'all'>('all');

  const trips = data ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trips.filter((trip) => {
      if (statusFilter !== 'all' && trip.status !== statusFilter) return false;
      if (!q) return true;
      return (
        trip.vehicleLabel.toLowerCase().includes(q) ||
        trip.id.toLowerCase().includes(q) ||
        (trip.driver?.toLowerCase().includes(q) ?? false) ||
        trip.originLabel.toLowerCase().includes(q) ||
        trip.destinationLabel.toLowerCase().includes(q)
      );
    });
  }, [trips, query, statusFilter]);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700}>
          {t('trips.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('trips.subtitle')}
        </Typography>
      </Box>

      {/* Search + status filters */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        gap={1.5}
        sx={{ mb: 2 }}
        alignItems="center"
        justifyContent="space-between"
      >
        <Stack direction="row" alignItems="center" gap={1} sx={{ flex: 1, maxWidth: 420 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.25,
              py: 0.75,
              borderRadius: 1.5,
              backgroundColor: 'action.hover',
              flex: 1,
            }}
          >
            <Search size={16} color="var(--mui-palette-text-secondary)" />
            <InputBase
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('trips.list.searchPlaceholder')}
              inputProps={{ 'aria-label': t('trips.list.search') }}
              sx={{ flex: 1, fontSize: '0.875rem' }}
            />
          </Box>
        </Stack>
        <Stack direction="row" gap={0.75} flexWrap="wrap">
          <Chip
            size="small"
            label={t('trips.status.all')}
            onClick={() => setStatusFilter('all')}
            variant={statusFilter === 'all' ? 'filled' : 'outlined'}
            color={statusFilter === 'all' ? 'primary' : 'default'}
            sx={{ height: 28, fontWeight: 600 }}
          />
          {STATUSES.map((s) => (
            <Chip
              key={s}
              size="small"
              label={t(`trips.status.${s}`)}
              onClick={() => setStatusFilter(s)}
              variant={statusFilter === s ? 'filled' : 'outlined'}
              color={statusFilter === s ? STATUS_COLOR[s] : 'default'}
              sx={{ height: 28, fontWeight: 600 }}
            />
          ))}
        </Stack>
      </Stack>

      {/* Table */}
      <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: 'action.hover' }}>
              <TableCell sx={{ fontWeight: 600 }}>{t('trips.list.colTrip')}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t('trips.list.colVehicle')}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t('trips.list.colRoute')}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t('trips.list.colDate')}</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                {t('trips.list.colDistance')}
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                {t('trips.list.colDuration')}
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t('trips.list.colStatus')}</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading
              ? SKELETON_KEYS.map((sk) => (
                  <TableRow key={sk}>
                    <TableCell colSpan={8}>
                      <Skeleton variant="text" />
                    </TableCell>
                  </TableRow>
                ))
              : filtered.map((trip) => (
                  <TripRow
                    key={trip.id}
                    trip={trip}
                    t={t}
                    onOpen={() => navigate(`/trips/${trip.id}`)}
                  />
                ))}
          </TableBody>
        </Table>
      </TableContainer>

      {!isLoading && filtered.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          {t('trips.list.noResults')}
        </Typography>
      )}
    </Box>
  );
}

/** A single trip row — hover highlights, click opens the detail. */
function TripRow({
  trip,
  t,
  onOpen,
}: {
  trip: Trip;
  t: (k: string) => string;
  onOpen: () => void;
}) {
  const date = new Date(trip.startTime).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return (
    <TableRow hover onClick={onOpen} sx={{ cursor: 'pointer', '&:last-child td': { border: 0 } }}>
      <TableCell sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{trip.id}</TableCell>
      <TableCell>{trip.vehicleLabel}</TableCell>
      <TableCell>
        <Typography variant="body2" noWrap>
          {trip.originLabel} → {trip.destinationLabel}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {date}
        </Typography>
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {trip.distanceKm} km
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatDuration(trip.durationMin)}
      </TableCell>
      <TableCell>
        <Chip
          size="small"
          label={t(`trips.status.${trip.status}`)}
          color={STATUS_COLOR[trip.status]}
          variant={trip.status === 'planned' ? 'outlined' : 'filled'}
          sx={{ height: 22, fontSize: '0.72rem', fontWeight: 600, textTransform: 'none' }}
        />
      </TableCell>
      <TableCell>
        <ArrowRight size={16} color="var(--mui-palette-text-secondary)" />
      </TableCell>
    </TableRow>
  );
}

/** Status badge dot color fallback (kept for the planned outlined chip). */
function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

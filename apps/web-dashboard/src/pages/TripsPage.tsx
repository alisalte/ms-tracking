import { Box, Card, Stack } from '@mui/material';
import { ArrowRight, Route } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useTrips } from '@/api/fleet.api';
import { type Column, EmptyState, PageHeader, StatusBadge, Toolbar } from '@/components/ui';
import { DataTable } from '@/components/ui';
import type { Trip, TripStatus } from '@/types/fleet.types';

/** Status → StatusBadge tone. */
const STATUS_TONE: Record<TripStatus, 'success' | 'info' | 'neutral' | 'danger'> = {
  completed: 'success',
  in_progress: 'info',
  planned: 'neutral',
  cancelled: 'danger',
};

const STATUSES: TripStatus[] = ['completed', 'in_progress', 'planned', 'cancelled'];

/**
 * TripsPage — the fleet trip roster.
 *
 * A filterable table of trips (search by vehicle/driver + status chips). Row
 * click → trip detail with replay. Backed by `useTrips`: in REAL mode the
 * backend exposes no trips API yet, so the page honestly shows its
 * "not available yet" empty state (§22 — no fabricated rows); the deterministic
 * fixtures still load in explicit dev/demo mock mode (`?useMock=true`) so the
 * replay UX stays demoable.
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

  const columns: Array<Column<Trip>> = [
    {
      id: 'trip',
      headerKey: 'trips.list.colTrip',
      render: (trip) => (
        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{trip.id}</span>
      ),
    },
    { id: 'vehicle', headerKey: 'trips.list.colVehicle', render: (trip) => trip.vehicleLabel },
    {
      id: 'route',
      headerKey: 'trips.list.colRoute',
      render: (trip) => (
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {trip.originLabel} → {trip.destinationLabel}
        </span>
      ),
    },
    {
      id: 'date',
      headerKey: 'trips.list.colDate',
      render: (trip) => (
        <span
          style={{ color: 'var(--mui-palette-text-secondary)', fontVariantNumeric: 'tabular-nums' }}
        >
          {new Date(trip.startTime).toLocaleDateString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      ),
    },
    {
      id: 'distance',
      headerKey: 'trips.list.colDistance',
      align: 'right',
      render: (trip) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{trip.distanceKm} km</span>
      ),
    },
    {
      id: 'duration',
      headerKey: 'trips.list.colDuration',
      align: 'right',
      render: (trip) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatDuration(trip.durationMin)}
        </span>
      ),
    },
    {
      id: 'status',
      headerKey: 'trips.list.colStatus',
      render: (trip) => (
        <StatusBadge
          label={t(`trips.status.${trip.status}`)}
          tone={STATUS_TONE[trip.status]}
          variant={trip.status === 'planned' ? 'outlined' : 'solid'}
        />
      ),
    },
    {
      id: 'open',
      width: 32,
      render: () => <ArrowRight size={16} color="var(--mui-palette-text-secondary)" />,
    },
  ];

  return (
    <Box>
      <PageHeader title={t('trips.title')} subtitle={t('trips.subtitle')} />

      {!isLoading && trips.length === 0 ? (
        /* REAL mode: no trips API yet — honest empty state, never fake rows. */
        <Card>
          <EmptyState
            icon={Route}
            title={t('trips.empty.title')}
            description={t('trips.empty.notAvailable')}
            py={10}
          />
        </Card>
      ) : (
        <Card>
          <Toolbar
            search
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholderKey="trips.list.searchPlaceholder"
            right={
              <Stack direction="row" gap={0.75} flexWrap="wrap" alignItems="center">
                <StatusBadge
                  label={t('trips.status.all')}
                  tone="neutral"
                  variant={statusFilter === 'all' ? 'solid' : 'outlined'}
                  active={statusFilter === 'all'}
                  onClick={() => setStatusFilter('all')}
                />
                {STATUSES.map((s) => (
                  <StatusBadge
                    key={s}
                    label={t(`trips.status.${s}`)}
                    tone={STATUS_TONE[s]}
                    variant={statusFilter === s ? 'solid' : 'outlined'}
                    active={statusFilter === s}
                    onClick={() => setStatusFilter(s)}
                  />
                ))}
              </Stack>
            }
          />
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(trip) => trip.id}
            loading={isLoading}
            onRowClick={(trip) => navigate(`/trips/${trip.id}`)}
            maxHeight="calc(100vh - 280px)"
          />
        </Card>
      )}
    </Box>
  );
}

/** Format minutes → compact duration string. */
function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

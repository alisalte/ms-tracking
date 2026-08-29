import { ArrowRight, Route, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { useTrips } from '@/api/fleet.api';
import { ErrorState } from '@/components/common/ErrorState';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SegmentedControl,
  type SegmentedOption,
  type TableColumn,
  Toolbar,
} from '@/components/tailwind-ui';
import { displayLabel } from '@/lib/ids';
import type { Trip, TripStatus } from '@/types/fleet.types';

/** Status → Badge color (cell). */
const STATUS_COLOR: Record<TripStatus, 'success' | 'info' | 'gray' | 'danger'> = {
  completed: 'success',
  in_progress: 'info',
  planned: 'gray',
  cancelled: 'danger',
};

const STATUSES: TripStatus[] = ['completed', 'in_progress', 'planned', 'cancelled'];

/**
 * TripsPage — the fleet trip roster (TailAdmin port).
 *
 * A filterable table of trips (search by vehicle/driver + status segmented
 * control). Row click → trip detail with replay. Backed by `useTrips`: fetch
 * failures surface as ErrorState with retry, and an absent roster keeps the
 * toolbar mounted with its honest "not available yet" empty state (§22 — no
 * fabricated rows); the deterministic fixtures still load in explicit dev/demo
 * mock mode (`?useMock=true`) so the replay UX stays demoable.
 */
export function TripsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, isError, error, refetch } = useTrips();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TripStatus | 'all'>('all');

  // Deep link: /trips?vehicle=<id> (device-popup "trip timeline") pre-filters
  // the roster to one vehicle until the operator clears the chip.
  const vehicleFilter = params.get('vehicle');
  const clearVehicleFilter = () => {
    params.delete('vehicle');
    setParams(params, { replace: true });
  };

  const trips = data ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trips.filter((trip) => {
      if (vehicleFilter && trip.vehicleId !== vehicleFilter) return false;
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
  }, [trips, query, statusFilter, vehicleFilter]);

  const columns: Array<TableColumn<Trip>> = [
    {
      id: 'trip',
      headerKey: 'trips.list.colTrip',
      sortBy: (trip) => trip.vehicleLabel || trip.id,
      render: (trip) => (
        <span className="font-semibold">{displayLabel(trip.id, trip.vehicleLabel) ?? '—'}</span>
      ),
    },
    {
      id: 'vehicle',
      headerKey: 'trips.list.colVehicle',
      sortBy: (trip) => trip.vehicleLabel,
      render: (trip) => trip.vehicleLabel,
    },
    {
      id: 'route',
      headerKey: 'trips.list.colRoute',
      render: (trip) => (
        <span className="block max-w-64 truncate">
          {trip.originLabel} → {trip.destinationLabel}
        </span>
      ),
    },
    {
      id: 'date',
      headerKey: 'trips.list.colDate',
      sortBy: (trip) => trip.startTime,
      render: (trip) => (
        <span className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
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
      align: 'end',
      sortBy: (trip) => trip.distanceKm,
      render: (trip) => <span className="tabular-nums">{trip.distanceKm} km</span>,
    },
    {
      id: 'duration',
      headerKey: 'trips.list.colDuration',
      align: 'end',
      sortBy: (trip) => trip.durationMin,
      render: (trip) => <span className="tabular-nums">{formatDuration(trip.durationMin)}</span>,
    },
    {
      id: 'status',
      headerKey: 'trips.list.colStatus',
      sortBy: (trip) => trip.status,
      render: (trip) => (
        <Badge color={STATUS_COLOR[trip.status]} dot>
          {t(`trips.status.${trip.status}`)}
        </Badge>
      ),
    },
    {
      id: 'open',
      width: 32,
      render: () => (
        <ArrowRight
          size={16}
          aria-hidden
          className="text-gray-400 rtl:rotate-180 dark:text-graydark-600"
        />
      ),
    },
  ];

  /** Status filter segments (All + the four lifecycle states). */
  const statusOptions: Array<SegmentedOption<TripStatus | 'all'>> = [
    { value: 'all', label: t('trips.status.all') },
    ...STATUSES.map((s) => ({ value: s as TripStatus | 'all', label: t(`trips.status.${s}`) })),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <PageHeader title={t('trips.title')} description={t('trips.subtitle')} />

      {isError ? (
        /* Failed fetch — surfaced honestly with a retry, never a fake roster. */
        <Card flush className="p-2">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {vehicleFilter && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearVehicleFilter}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-500/15 dark:text-brand-300"
              >
                {t('trips.list.vehicleFilter')}
                <X size={13} aria-hidden />
              </button>
            </div>
          )}
          {/* Toolbar stays mounted even when the roster is empty so the search
              and status filter remain usable (e.g. before the API ships). */}
          <Toolbar
            search
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder={t('trips.list.searchPlaceholder')}
            right={
              <SegmentedControl
                options={statusOptions}
                value={statusFilter}
                onChange={setStatusFilter}
                aria-label={t('trips.list.filterByStatus')}
                size="sm"
              />
            }
          />
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(trip) => trip.id}
            loading={isLoading}
            onRowClick={(trip) => navigate(`/trips/${trip.id}`)}
            maxHeight="calc(100vh - 280px)"
            emptyState={
              trips.length === 0 ? (
                /* REAL mode: no trips API yet — honest empty state, never fake rows. */
                <EmptyState
                  icon={<Route />}
                  title={t('trips.empty.title')}
                  description={t('trips.empty.notAvailable')}
                  className="py-10"
                />
              ) : (
                <EmptyState
                  icon={<Route />}
                  title={t('trips.empty.title')}
                  description={t('trips.list.noResults')}
                />
              )
            }
          />
        </div>
      )}
    </div>
  );
}

/** Format minutes → compact duration string. */
function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

import { ArrowLeft, ArrowRight, Clock3, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useParams } from 'react-router';

import type { ApiClientError } from '@/api/errors';
import { useTripDetail } from '@/api/fleet.api';
import { ErrorState } from '@/components/common/ErrorState';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@/components/tailwind-ui';
import { SpeedGraph } from '@/components/trips/SpeedGraph';
import { TripReplayMap } from '@/components/trips/TripReplayMap';
import { TripSummary } from '@/components/trips/TripSummary';
import { TripTimeline } from '@/components/trips/TripTimeline';
import { useTripPlayback } from '@/components/trips/useTripPlayback';
import { shouldUseMock } from '@/lib/mock-gate';
import { status as statusPalette } from '@/theme/palette';
import type { Trip, TripEvent } from '@/types/fleet.types';

/** Speed limit used for the reference line (km/h) — matches the mock generator. */
const SPEED_LIMIT_KMH = 100;

/** Event type → list-dot color (semantic palette — Phase 2.6 §10). */
const EVENT_COLOR: Record<TripEvent['type'], string> = {
  stop: statusPalette.warning,
  idle: statusPalette.slate,
  overspeed: statusPalette.danger,
  geofence: statusPalette.purple,
};

/** Trip status → Badge color. */
const STATUS_COLOR: Record<Trip['status'], 'success' | 'info' | 'gray' | 'danger'> = {
  completed: 'success',
  in_progress: 'info',
  planned: 'gray',
  cancelled: 'danger',
};

/** Secondary sm link-button (TailAdmin button look on a router link). */
function linkButtonClassName(): string {
  return (
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800 dark:hover:bg-graydark-400'
  );
}

/**
 * TripDetailPage — a single trip with GPS replay (TailAdmin port).
 *
 * Layout: header (vehicle + route + date + status), `TripSummary`, then a
 * 2-column grid with the replay map (left) and speed graph (right), the
 * transport timeline (full width), and an events list. The shared playback
 * hook drives the map marker, the speed-graph playhead, and the timeline.
 *
 * REAL mode: `GET /trips/:id` backs the page — failures render ErrorState
 * (404 → the not-found empty state), and while the API is absent the query
 * resolves to null and the page shows its honest "not available yet" empty
 * state (§22 — never fake data). In explicit dev/demo mock mode
 * (`?useMock=true`) the deterministic fixtures load and the full replay works.
 */
export function TripDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data: trip, isLoading, isError, error, refetch } = useTripDetail(id ?? null);
  const waypoints = trip?.waypoints ?? [];
  const events = trip?.events ?? [];
  const playback = useTripPlayback(waypoints.length);

  const startLabel = useMemo(
    () =>
      trip
        ? new Date(trip.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
        : '',
    [trip],
  );

  /** Compact start date for the page title (matches the roster's date column). */
  const dateLabel = useMemo(
    () =>
      trip
        ? new Date(trip.startTime).toLocaleDateString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : '',
    [trip],
  );

  if (isLoading) {
    /* Layout-preserving skeleton: back-link row, title, summary tiles, the
       map/speed-graph row, timeline, and events list — same shape as the page
       so there is no jump when data lands. */
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
      <div className="flex flex-col gap-4" role="status" aria-label={t('common.loading')}>
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-9 w-2/3" />
        <div className="my-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 7 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder.
            <Skeleton key={i} className="h-[76px] rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-90 rounded-2xl" />
          <Skeleton className="h-90 rounded-2xl" />
        </div>
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (isError) {
    const notFound = (error as Partial<ApiClientError> | null)?.status === 404;
    return (
      <div className="py-6">
        <RouterLink to="/trips" className={`${linkButtonClassName()} mb-2`}>
          <ArrowLeft size={14} aria-hidden className="rtl:rotate-180" />
          {t('trips.detail.back')}
        </RouterLink>
        {notFound ? (
          <EmptyState
            icon={<MapPin />}
            title={t('trips.detail.notFound')}
            description={t('trips.detail.notFoundHelp')}
          />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="py-6">
        <RouterLink to="/trips" className={`${linkButtonClassName()} mb-2`}>
          <ArrowLeft size={14} aria-hidden className="rtl:rotate-180" />
          {t('trips.detail.back')}
        </RouterLink>
        {shouldUseMock() ? (
          <EmptyState
            icon={<MapPin />}
            title={t('trips.detail.notFound')}
            description={t('trips.detail.notFoundHelp')}
          />
        ) : (
          <EmptyState
            icon={<MapPin />}
            title={t('trips.empty.title')}
            description={t('trips.empty.notAvailable')}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <RouterLink to="/trips" className={linkButtonClassName()}>
          <ArrowLeft size={14} aria-hidden className="rtl:rotate-180" />
          {t('trips.detail.back')}
        </RouterLink>
        {/*
         * Sprint I §37 — trip → map: opens the /map history mode preloaded with
         * the trip's vehicle + time window (custom range deep link).
         */}
        <RouterLink
          to={`/map?vehicle=${encodeURIComponent(trip.vehicleId)}&from=${encodeURIComponent(
            new Date(trip.startTime).toISOString(),
          )}&to=${encodeURIComponent(new Date(trip.endTime ?? Date.now()).toISOString())}`}
          className={linkButtonClassName()}
          data-testid="trip-show-on-map"
        >
          {t('trips.detail.showOnMap')}
        </RouterLink>
      </div>
      <PageHeader
        title={trip.vehicleLabel ? `${trip.vehicleLabel} · ${dateLabel}` : trip.id}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-graydark-600">
              <MapPin size={15} aria-hidden />
              {trip.originLabel}
              {/* Directional affordance — mirrors in RTL. */}
              <ArrowRight size={13} aria-hidden className="rtl:rotate-180" />
              {trip.destinationLabel}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-graydark-600">
              <Clock3 size={15} aria-hidden />
              {startLabel}
            </span>
          </span>
        }
        actions={
          <Badge color={STATUS_COLOR[trip.status]} dot className="font-semibold">
            {t(`trips.status.${trip.status}`)}
          </Badge>
        }
      />

      {/* Summary tiles */}
      <div className="my-6">
        <TripSummary trip={trip} />
      </div>

      {/* Replay: map (left) + speed graph (right) */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card flush className="h-90 overflow-hidden">
          <TripReplayMap waypoints={waypoints} events={events} index={playback.index} />
        </Card>
        <Card className="flex h-90 flex-col">
          <CardHeader title={t('trips.replay.speedGraph')} />
          <div className="min-h-0 flex-1">
            <SpeedGraph
              waypoints={waypoints}
              speedLimitKmh={SPEED_LIMIT_KMH}
              index={playback.index}
            />
          </div>
        </Card>
      </div>

      {/* Transport timeline */}
      <Card className="mb-4">
        <CardHeader title={t('trips.replay.timeline')} />
        {waypoints.length === 0 ? (
          <Skeleton className="h-14 w-full rounded-lg" />
        ) : (
          <TripTimeline
            waypoints={waypoints}
            events={events}
            index={playback.index}
            isPlaying={playback.isPlaying}
            speed={playback.speed}
            onToggle={playback.toggle}
            onSeek={playback.seek}
            onSpeedChange={playback.setSpeed}
          />
        )}
      </Card>

      {/* Events list (stops / idle / overspeed) */}
      <Card>
        <CardHeader title={t('trips.events.title')} />
        {events.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-graydark-600">{t('trips.events.none')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: EVENT_COLOR[e.type] }}
                />
                <p className="min-w-0 flex-1 text-sm text-gray-800 dark:text-graydark-800">
                  {t(`trips.events.${e.type}`)}
                  <span className="text-xs text-gray-500 dark:text-graydark-600">
                    {' · '}
                    {e.label}
                    {e.durationMin ? ` · ${e.durationMin}m` : ''}
                  </span>
                </p>
                <span className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
                  {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

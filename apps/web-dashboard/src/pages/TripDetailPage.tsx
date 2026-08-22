import { ArrowLeft, Clock3, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useParams } from 'react-router';

import { useTripDetail } from '@/api/fleet.api';
import { Badge, Card, EmptyState, Skeleton, Spinner } from '@/components/tailwind-ui';
import { SpeedGraph } from '@/components/trips/SpeedGraph';
import { TripReplayMap } from '@/components/trips/TripReplayMap';
import { TripSummary } from '@/components/trips/TripSummary';
import { TripTimeline } from '@/components/trips/TripTimeline';
import { useTripPlayback } from '@/components/trips/useTripPlayback';
import { shouldUseMock } from '@/lib/mock-gate';
import type { Trip, TripEvent } from '@/types/fleet.types';

/** Speed limit used for the reference line (km/h) — matches the mock generator. */
const SPEED_LIMIT_KMH = 100;

/** Event type → list-dot color. */
const EVENT_COLOR: Record<TripEvent['type'], string> = {
  stop: '#F59E0B',
  idle: '#64748B',
  overspeed: '#DC2626',
  geofence: '#A78BFA',
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
 * REAL mode: the trips API does not exist yet, so `useTripDetail` resolves to
 * null and this page shows its honest "not available yet" empty state (§22 —
 * never fake data). In explicit dev/demo mock mode (`?useMock=true`) the
 * deterministic fixtures load and the full replay UI works.
 */
export function TripDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data: trip, isLoading } = useTripDetail(id ?? null);
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

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="py-6">
        <RouterLink to="/trips" className={`${linkButtonClassName()} mb-2`}>
          <ArrowLeft size={14} aria-hidden />
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
          <ArrowLeft size={14} aria-hidden />
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
      <div className="mb-1 flex flex-col justify-between gap-2 md:flex-row">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            {trip.id}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-graydark-600">
              <MapPin size={15} aria-hidden />
              {trip.originLabel} → {trip.destinationLabel}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-graydark-600">
              <Clock3 size={15} aria-hidden />
              {trip.vehicleLabel} · {startLabel}
            </span>
          </div>
        </div>
        <Badge color={STATUS_COLOR[trip.status]} dot className="self-start font-semibold">
          {t(`trips.status.${trip.status}`)}
        </Badge>
      </div>

      {/* Summary tiles */}
      <div className="my-6">
        <TripSummary trip={trip} />
      </div>

      {/* Replay: map (left) + speed graph (right) */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card flush className="h-90 overflow-hidden">
          <TripReplayMap waypoints={waypoints} events={events} index={playback.index} />
        </Card>
        <Card className="flex h-90 flex-col gap-2">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
            {t('trips.replay.speedGraph')}
          </h2>
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
        <h2 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white">
          {t('trips.replay.timeline')}
        </h2>
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
        <h2 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white">
          {t('trips.events.title')}
        </h2>
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

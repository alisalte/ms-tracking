import { ArrowLeft, Clock3, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { useTripDetail } from '@/api/fleet.api';
import { SpeedGraph } from '@/components/trips/SpeedGraph';
import { TripReplayMap } from '@/components/trips/TripReplayMap';
import { TripSummary } from '@/components/trips/TripSummary';
import { TripTimeline } from '@/components/trips/TripTimeline';
import { useTripPlayback } from '@/components/trips/useTripPlayback';
import { EmptyState } from '@/components/ui';
import { shouldUseMock } from '@/lib/mock-gate';
import type { TripEvent } from '@/types/fleet.types';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';

/** Speed limit used for the reference line (km/h) — matches the mock generator. */
const SPEED_LIMIT_KMH = 100;

/** Event type → list-dot color. */
const EVENT_COLOR: Record<TripEvent['type'], string> = {
  stop: '#F59E0B',
  idle: '#64748B',
  overspeed: '#DC2626',
  geofence: '#A78BFA',
};

/**
 * TripDetailPage — a single trip with GPS replay.
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
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!trip) {
    return (
      <Box sx={{ py: 6 }}>
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
          <Button
            component={Link}
            to="/trips"
            startIcon={<ArrowLeft size={16} />}
            size="small"
            sx={{ textTransform: 'none' }}
          >
            {t('trips.detail.back')}
          </Button>
        </Stack>
        {shouldUseMock() ? (
          <EmptyState
            icon={MapPin}
            title={t('trips.detail.notFound')}
            description={t('trips.detail.notFoundHelp')}
          />
        ) : (
          <EmptyState
            icon={MapPin}
            title={t('trips.empty.title')}
            description={t('trips.empty.notAvailable')}
          />
        )}
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
        <Button
          component={Link}
          to="/trips"
          startIcon={<ArrowLeft size={16} />}
          size="small"
          sx={{ textTransform: 'none' }}
        >
          {t('trips.detail.back')}
        </Button>
      </Stack>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        gap={1}
        sx={{ mb: 0.5 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            {trip.id}
          </Typography>
          <Stack direction="row" alignItems="center" gap={2} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
            <Stack direction="row" alignItems="center" gap={0.5}>
              <MapPin size={15} color="var(--mui-palette-text-secondary)" />
              <Typography variant="body2" color="text.secondary">
                {trip.originLabel} → {trip.destinationLabel}
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" gap={0.5}>
              <Clock3 size={15} color="var(--mui-palette-text-secondary)" />
              <Typography variant="body2" color="text.secondary">
                {trip.vehicleLabel} · {startLabel}
              </Typography>
            </Stack>
          </Stack>
        </Box>
        <Chip
          label={t(`trips.status.${trip.status}`)}
          color={
            trip.status === 'completed'
              ? 'success'
              : trip.status === 'in_progress'
                ? 'info'
                : trip.status === 'cancelled'
                  ? 'error'
                  : 'default'
          }
          variant={trip.status === 'planned' ? 'outlined' : 'filled'}
          sx={{ fontWeight: 600, alignSelf: 'flex-start' }}
        />
      </Stack>

      {/* Summary tiles */}
      <Box sx={{ my: 3 }}>
        <TripSummary trip={trip} />
      </Box>

      {/* Replay: map (left) + speed graph (right) */}
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.4fr 1fr' }, gap: 2, mb: 2 }}
      >
        <Card sx={{ p: 0, overflow: 'hidden', height: 360 }}>
          <TripReplayMap waypoints={waypoints} events={events} index={playback.index} />
        </Card>
        <Card>
          <CardContent sx={{ height: 360, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {t('trips.replay.speedGraph')}
            </Typography>
            <Box sx={{ flex: 1 }}>
              <SpeedGraph
                waypoints={waypoints}
                speedLimitKmh={SPEED_LIMIT_KMH}
                index={playback.index}
              />
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Transport timeline */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={600}>
            {t('trips.replay.timeline')}
          </Typography>
          {waypoints.length === 0 ? (
            <Skeleton variant="rounded" height={56} />
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
        </CardContent>
      </Card>

      {/* Events list (stops / idle / overspeed) */}
      <Card>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
            {t('trips.events.title')}
          </Typography>
          {events.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('trips.events.none')}
            </Typography>
          ) : (
            <Stack gap={0.5}>
              {events.map((e) => (
                <Stack key={e.id} direction="row" alignItems="center" gap={1}>
                  <Box
                    component="span"
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: EVENT_COLOR[e.type],
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {t(`trips.events.${e.type}`)}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' · '}
                      {e.label}
                      {e.durationMin ? ` · ${e.durationMin}m` : ''}
                    </Typography>
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

import {
  Box,
  IconButton,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { status } from '@/theme/palette';
import type { TripEvent, TripWaypoint } from '@/types/fleet.types';
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from './useTripPlayback';

interface TripTimelineProps {
  waypoints: TripWaypoint[];
  events: TripEvent[];
  index: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  onToggle: () => void;
  onSeek: (i: number) => void;
  onSpeedChange: (s: PlaybackSpeed) => void;
}

/** Event type → timeline tick color. */
const TICK_COLOR: Record<TripEvent['type'], string> = {
  stop: status.amber,
  idle: status.slate,
  overspeed: status.red,
  geofence: '#A78BFA',
};

/**
 * TripTimeline — the seekable replay scrubber.
 *
 * Play/pause + 1×/2×/4× speed + a draggable playhead over the trip duration.
 * Event markers (stop/idle/overspeed) are rendered as colored ticks above the
 * track; clicking a tick seeks playback there (adapted from §3.7 video
 * transport). The current time + total duration are shown at the ends.
 */
export function TripTimeline({
  waypoints,
  events,
  index,
  isPlaying,
  speed,
  onToggle,
  onSeek,
  onSpeedChange,
}: TripTimelineProps) {
  const { t } = useTranslation();
  const total = waypoints.length;
  if (total === 0) return null;
  const first = waypoints[0];
  const last = waypoints[total - 1];

  // Map an event timestamp onto a slider position (0..total-1).
  const eventPos = (e: TripEvent): number => {
    const start = first ? new Date(first.ts).getTime() : 0;
    const end = last ? new Date(last.ts).getTime() : 0;
    const ts = new Date(e.ts).getTime();
    if (end === start) return 0;
    return Math.round(((ts - start) / (end - start)) * (total - 1));
  };

  const current = waypoints[index];
  const startLabel = first
    ? new Date(first.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
  const endLabel = last
    ? new Date(last.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
  const nowLabel = current
    ? new Date(current.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : startLabel;

  return (
    <Stack gap={1.5}>
      {/* Transport controls */}
      <Stack direction="row" alignItems="center" gap={1.5}>
        <IconButton
          onClick={onToggle}
          aria-label={isPlaying ? t('trips.timeline.pause') : t('trips.timeline.play')}
          size="small"
          color="primary"
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </IconButton>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={speed}
          onChange={(_, s: PlaybackSpeed | null) => s && onSpeedChange(s)}
          aria-label={t('trips.timeline.speed')}
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <ToggleButton
              key={s}
              value={s}
              sx={{
                px: 1.25,
                py: 0.25,
                fontSize: '0.75rem',
                textTransform: 'none',
                lineHeight: 1.4,
              }}
            >
              {s}×
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {nowLabel}
        </Typography>
      </Stack>

      {/* Event ticks (clickable → seek) */}
      <Box sx={{ position: 'relative', height: 14, px: 0.5 }}>
        {events.map((e) => {
          const pos = (eventPos(e) / Math.max(1, total - 1)) * 100;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onSeek(eventPos(e))}
              title={`${t(`trips.events.${e.type}`)} — ${e.label}`}
              aria-label={`${t(`trips.events.${e.type}`)} ${e.label}`}
              style={{
                position: 'absolute',
                left: `${pos}%`,
                top: 0,
                transform: 'translateX(-50%)',
                width: 4,
                height: 14,
                borderRadius: 2,
                border: 'none',
                backgroundColor: TICK_COLOR[e.type],
                cursor: 'pointer',
                padding: 0,
              }}
            />
          );
        })}
      </Box>

      {/* Seekable playhead slider */}
      <Slider
        value={index}
        min={0}
        max={total - 1}
        step={1}
        onChange={(_, v) => {
          const next = Array.isArray(v) ? v[0] : v;
          if (typeof next === 'number') onSeek(next);
        }}
        aria-label={t('trips.timeline.seek')}
        sx={{ mt: -0.5 }}
      />

      <Stack direction="row" justifyContent="space-between">
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {startLabel}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {endLabel}
        </Typography>
      </Stack>
    </Stack>
  );
}

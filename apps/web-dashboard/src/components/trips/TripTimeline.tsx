import { Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IconButton, SegmentedControl } from '@/components/tailwind-ui';
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
  geofence: status.purple,
};

/**
 * TripTimeline — the seekable replay scrubber (TailAdmin port).
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
    <div className="flex flex-col gap-3">
      {/* Transport controls */}
      <div className="flex items-center gap-3">
        <IconButton
          onClick={onToggle}
          aria-label={isPlaying ? t('trips.timeline.pause') : t('trips.timeline.play')}
          size="sm"
          variant="outline"
        >
          {isPlaying ? (
            <Pause size={16} aria-hidden />
          ) : (
            <Play size={16} aria-hidden className="ms-0.5" />
          )}
        </IconButton>
        <SegmentedControl
          options={PLAYBACK_SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
          value={speed}
          onChange={onSpeedChange}
          aria-label={t('trips.timeline.speed')}
          size="sm"
        />
        <span className="text-sm tabular-nums text-gray-500 dark:text-graydark-600">
          {nowLabel}
        </span>
      </div>

      {/* Event ticks (clickable → seek) */}
      <div className="relative h-3.5 px-1">
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
                // insetInlineStart mirrors under dir=rtl (plain `left` would
                // desync the ticks from the native range input, which mirrors).
                insetInlineStart: `${pos}%`,
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
      </div>

      {/* Seekable playhead slider */}
      <input
        type="range"
        value={index}
        min={0}
        max={total - 1}
        step={1}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label={t('trips.timeline.seek')}
        className="-mt-1 h-1.5 w-full cursor-pointer accent-brand-500"
      />

      <div className="flex justify-between">
        <span className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
          {startLabel}
        </span>
        <span className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
          {endLabel}
        </span>
      </div>
    </div>
  );
}

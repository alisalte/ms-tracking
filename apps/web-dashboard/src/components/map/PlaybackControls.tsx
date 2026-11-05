import { ChevronLeft, ChevronRight, Pause, Play, Square } from 'lucide-react';
/**
 * PlaybackControls — the history-playback transport (Sprint I §32/§33, TailAdmin).
 *
 * Play / Pause / Stop / Previous / Next, speeds 1×/2×/4×/8×, and a timeline
 * slider bound to the track's [start, end] window showing the CURRENT
 * timestamp. Seeking by timeline snaps to real GPS samples (gap-aware — see
 * useTrackPlayback). Pure presentational; the engine lives in the hook.
 *
 * Contract preserved from the MUI version: every data-testid (playback-*),
 * the aria-labels, and the "{speed}×" button names used by the e2e suite.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/components/tailwind-ui';
import { formatDateTime, formatTime } from '@/lib/format-date';
import { PLAYBACK_SPEEDS, type UseTrackPlaybackResult } from './useTrackPlayback';

function fmtTime(ms: number): string {
  return formatTime(ms, { second: '2-digit' });
}
function fmtFull(ms: number): string {
  return formatDateTime(ms);
}

export function PlaybackControls({
  playback,
  onHeightChange,
}: {
  playback: UseTrackPlaybackResult;
  /** Reports the bar's rendered height (0 when hidden) so map controls can sit above it. */
  onHeightChange?: (height: number) => void;
}) {
  const { t } = useTranslation();
  const { startMs, endMs, cursorMs, isPlaying, speed } = playback;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visible = startMs !== null && endMs !== null && endMs > startMs;

  useEffect(() => {
    const el = rootRef.current;
    if (!onHeightChange) return;
    if (!visible || !el) {
      onHeightChange(0);
      return;
    }
    const report = () => onHeightChange(el.offsetHeight);
    report();
    if (typeof ResizeObserver === 'undefined') return () => onHeightChange(0);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      onHeightChange(0);
    };
  }, [visible, onHeightChange]);

  const onRangeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      playback.seek(Number(event.target.value));
    },
    [playback],
  );

  if (startMs === null || endMs === null || endMs <= startMs) return null;

  return (
    <div
      ref={rootRef}
      className="absolute bottom-2 start-2 end-2 z-10 rounded-xl bg-white/90 px-3 py-2 shadow-sm backdrop-blur-md dark:bg-graydark-300/90"
      data-testid="playback-controls"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <IconButton
          size="sm"
          onClick={playback.prev}
          aria-label={t('map.playback.prev')}
          data-testid="playback-prev"
        >
          {/* Physical prev/next glyphs mirror in RTL (the slider mirrors). */}
          <ChevronLeft size={17} className="rtl:rotate-180" />
        </IconButton>
        <IconButton
          size="sm"
          onClick={() => (isPlaying ? playback.pause() : playback.play())}
          aria-label={isPlaying ? t('map.playback.pause') : t('map.playback.play')}
          data-testid={isPlaying ? 'playback-pause' : 'playback-play'}
        >
          {isPlaying ? <Pause size={17} /> : <Play size={17} />}
        </IconButton>
        <IconButton
          size="sm"
          onClick={playback.stop}
          aria-label={t('map.playback.stop')}
          data-testid="playback-stop"
        >
          <Square size={15} />
        </IconButton>
        <IconButton
          size="sm"
          onClick={playback.next}
          aria-label={t('map.playback.next')}
          data-testid="playback-next"
        >
          <ChevronRight size={17} className="rtl:rotate-180" />
        </IconButton>

        <input
          type="range"
          min={startMs}
          max={endMs}
          value={cursorMs ?? startMs}
          onChange={onRangeChange}
          aria-label={t('map.playback.timeline')}
          data-testid="playback-timeline"
          className="order-first h-1.5 w-full basis-full cursor-pointer appearance-none sm:order-none sm:mx-2 sm:w-auto sm:min-w-40 sm:flex-1 sm:basis-0 rounded-full bg-gray-200 accent-brand-500 dark:bg-white/10"
        />

        <fieldset
          aria-label={t('map.playback.speed')}
          className="flex items-center overflow-hidden rounded-lg border border-gray-300 dark:border-white/10"
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => playback.setSpeed(s)}
              aria-pressed={speed === s}
              className={`cursor-pointer border-none px-2 py-1 text-xs font-semibold transition-colors ${
                speed === s
                  ? 'bg-brand-500 text-white'
                  : 'bg-transparent text-gray-600 hover:bg-gray-100 dark:text-graydark-700 dark:hover:bg-white/5'
              }`}
            >
              {s}×
            </button>
          ))}
        </fieldset>
      </div>
      <div className="mt-0.5 flex items-center justify-between">
        <span className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
          {fmtTime(startMs)}
        </span>
        <span
          className="text-xs font-semibold tabular-nums text-gray-800 dark:text-graydark-800"
          aria-live="polite"
          data-testid="playback-current"
          title={fmtFull(cursorMs ?? startMs)}
        >
          {fmtFull(cursorMs ?? startMs)}
        </span>
        <span className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
          {fmtTime(endMs)}
        </span>
      </div>
    </div>
  );
}

import { ChevronLeft, ChevronRight, Pause, Play, Square } from 'lucide-react';
/**
 * PlaybackControls — the history-playback transport (Sprint I §32/§33).
 *
 * Play / Pause / Stop / Previous / Next, speeds 1×/2×/4×/8×, and a timeline
 * slider bound to the track's [start, end] window showing the CURRENT
 * timestamp. Seeking by timeline snaps to real GPS samples (gap-aware — see
 * useTrackPlayback). Pure presentational; the engine lives in the hook.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Box,
  IconButton,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
  type UseTrackPlaybackResult,
} from './useTrackPlayback';

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
function fmtFull(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PlaybackControls({ playback }: { playback: UseTrackPlaybackResult }) {
  const { t } = useTranslation();
  const { startMs, endMs, cursorMs, isPlaying, speed } = playback;

  const onSliderChange = useCallback(
    (_: unknown, value: number | number[]) => {
      if (typeof value === 'number') playback.seek(value);
    },
    [playback],
  );

  if (startMs === null || endMs === null || endMs <= startMs) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        right: 8,
        zIndex: 10,
        backgroundColor: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(6px)',
        borderRadius: 1.5,
        px: 1.5,
        py: 0.75,
        boxShadow: '0px 1px 3px rgba(0,0,0,0.08)',
      }}
      data-testid="playback-controls"
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <IconButton
          size="small"
          onClick={playback.prev}
          aria-label={t('map.playback.prev')}
          data-testid="playback-prev"
        >
          <ChevronLeft size={18} />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => (isPlaying ? playback.pause() : playback.play())}
          aria-label={isPlaying ? t('map.playback.pause') : t('map.playback.play')}
          data-testid={isPlaying ? 'playback-pause' : 'playback-play'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </IconButton>
        <IconButton
          size="small"
          onClick={playback.stop}
          aria-label={t('map.playback.stop')}
          data-testid="playback-stop"
        >
          <Square size={16} />
        </IconButton>
        <IconButton
          size="small"
          onClick={playback.next}
          aria-label={t('map.playback.next')}
          data-testid="playback-next"
        >
          <ChevronRight size={18} />
        </IconButton>

        <Slider
          min={startMs}
          max={endMs}
          value={cursorMs}
          onChange={onSliderChange}
          size="small"
          sx={{ flex: 1, minWidth: 160, mx: 1 }}
          aria-label={t('map.playback.timeline')}
          data-testid="playback-timeline"
        />

        <ToggleButtonGroup
          size="small"
          exclusive
          value={speed}
          onChange={(_, v: PlaybackSpeed | null) => {
            if (v !== null) playback.setSpeed(v);
          }}
          aria-label={t('map.playback.speed')}
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <ToggleButton key={s} value={s} sx={{ py: 0.25, px: 1 }}>
              {s}×
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {fmtTime(startMs)}
        </Typography>
        <Typography
          variant="caption"
          fontWeight={600}
          sx={{ fontVariantNumeric: 'tabular-nums' }}
          aria-live="polite"
          data-testid="playback-current"
          title={fmtFull(cursorMs)}
        >
          {fmtFull(cursorMs)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {fmtTime(endMs)}
        </Typography>
      </Box>
    </Box>
  );
}

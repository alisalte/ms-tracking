/**
 * WallToolbar — the TailAdmin top control bar of the video wall (Phase 7).
 *
 * Renders the 6 HikCentral-style division presets (1/4/9/16/36/64), plus the
 * spotlight toggle, whole-wall fullscreen, round-robin rotation toggle, the
 * live-cap indicator, the saved-wall loader, and a "simulate alert pop-in"
 * demo button (10 §9.3 alert-driven pop-in).
 */
import { AlertTriangle, LayoutGrid, Maximize, Pause, Pin, Play, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IconButton, Tooltip } from '@/components/tailwind-ui';
import type { VideoWall, WallDivision } from '@/types/video.types';
import { WALL_DIVISIONS } from '@/types/video.types';

interface WallToolbarProps {
  /** Active division. */
  division: WallDivision;
  /** Change the division. */
  onDivisionChange: (d: WallDivision) => void;
  /** Spotlight slot or null. */
  spotlightSlot: number | null;
  /** Toggle spotlight on/off (clears or sets to slot 0). */
  onToggleSpotlight: () => void;
  /** Enter fullscreen on the whole wall viewport. */
  onFullscreenWall: () => void;
  /** Round-robin rotation enabled. */
  rotationOn: boolean;
  /** Toggle rotation. */
  onToggleRotation: () => void;
  /** Count of currently-live tiles. */
  liveCount: number;
  /** Count of assigned tiles total. */
  assignedCount: number;
  /** Live-stream cap. */
  maxLive: number;
  /** Saved wall layouts. */
  walls: VideoWall[] | undefined;
  /** Walls loading. */
  wallsLoading: boolean;
  /** Load a saved wall. */
  onLoadWall: (wall: VideoWall) => void;
  /** Save the current layout. */
  onSaveWall: () => void;
  /** Simulate an alert pop-in on a random tile (demo). */
  onSimulateAlert: () => void;
}

export function WallToolbar({
  division,
  onDivisionChange,
  spotlightSlot,
  onToggleSpotlight,
  onFullscreenWall,
  rotationOn,
  onToggleRotation,
  liveCount,
  assignedCount,
  maxLive,
  walls,
  wallsLoading,
  onLoadWall,
  onSaveWall,
  onSimulateAlert,
}: WallToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 dark:border-white/5 dark:bg-graydark-300">
      <h1 className="me-1 text-base font-bold text-gray-900 dark:text-white">{t('video.title')}</h1>

      {/* Division presets */}
      <fieldset
        aria-label={t('video.toolbar.divisions', { defaultValue: 'Grid layout' })}
        className="flex items-center overflow-hidden rounded-lg border border-gray-300 dark:border-white/10"
      >
        {WALL_DIVISIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDivisionChange(d)}
            aria-pressed={division === d}
            className={`min-w-11 cursor-pointer border-none px-2 py-1.5 text-sm font-semibold transition-colors ${
              division === d
                ? 'bg-brand-500 text-white'
                : 'bg-transparent text-gray-600 hover:bg-gray-100 dark:text-graydark-700 dark:hover:bg-white/5'
            }`}
          >
            {d}
          </button>
        ))}
      </fieldset>

      {/* Live-cap indicator */}
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-gray-300 px-2.5 text-xs font-semibold text-gray-600 dark:border-white/10 dark:text-graydark-700">
        <LayoutGrid size={13} aria-hidden />
        {liveCount} / {assignedCount} {t('video.toolbar.live')}
      </span>
      {assignedCount > maxLive && (
        <Tooltip label={`${t('video.toolbar.capHelp')} ${maxLive}`}>
          <span className="inline-flex h-6 items-center rounded-full border border-warning-200 bg-warning-50 px-2.5 text-xs font-semibold text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-400">
            {maxLive} {t('video.toolbar.cap')}
          </span>
        </Tooltip>
      )}

      <div className="mx-0.5 h-6 w-px bg-gray-200 dark:bg-white/10" />

      {/* Spotlight */}
      <Tooltip label={t('video.toolbar.spotlight')}>
        <IconButton
          size="sm"
          variant={spotlightSlot !== null ? 'solid' : 'ghost'}
          aria-label={t('video.toolbar.spotlight')}
          aria-pressed={spotlightSlot !== null}
          onClick={onToggleSpotlight}
        >
          <Pin size={17} fill={spotlightSlot !== null ? 'currentColor' : 'none'} />
        </IconButton>
      </Tooltip>

      {/* Rotation toggle */}
      <Tooltip
        label={rotationOn ? t('video.toolbar.pauseRotation') : t('video.toolbar.resumeRotation')}
      >
        <IconButton
          size="sm"
          variant={rotationOn ? 'solid' : 'ghost'}
          aria-label={
            rotationOn ? t('video.toolbar.pauseRotation') : t('video.toolbar.resumeRotation')
          }
          aria-pressed={rotationOn}
          onClick={onToggleRotation}
        >
          {rotationOn ? <Pause size={17} /> : <Play size={17} />}
        </IconButton>
      </Tooltip>

      {/* Fullscreen wall */}
      <Tooltip label={t('video.toolbar.fullscreenWall')}>
        <IconButton
          size="sm"
          aria-label={t('video.toolbar.fullscreenWall')}
          onClick={onFullscreenWall}
        >
          <Maximize size={17} />
        </IconButton>
      </Tooltip>

      {/* Simulate alert (demo) */}
      <Tooltip label={t('video.toolbar.simulateAlert')}>
        <IconButton
          size="sm"
          aria-label={t('video.toolbar.simulateAlert')}
          onClick={onSimulateAlert}
          className="text-warning-600 hover:bg-warning-50 dark:text-warning-400 dark:hover:bg-warning-500/10"
        >
          <AlertTriangle size={17} />
        </IconButton>
      </Tooltip>

      <div className="min-w-0 flex-1" />

      {/* Saved walls */}
      <div className="flex items-center gap-1.5">
        {wallsLoading ? (
          <span className="text-xs text-gray-400 dark:text-graydark-600">
            {t('common.loading')}
          </span>
        ) : (
          <select
            value=""
            onChange={(e) => {
              const w = walls?.find((x) => x.id === e.target.value);
              if (w) onLoadWall(w);
            }}
            aria-label={t('video.toolbar.loadWall')}
            className="h-8 cursor-pointer rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
          >
            <option value="">{t('video.toolbar.loadWall')}</option>
            {(walls ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.division})
              </option>
            ))}
          </select>
        )}
        <Tooltip label={t('video.toolbar.saveWall')}>
          <IconButton size="sm" aria-label={t('video.toolbar.saveWall')} onClick={onSaveWall}>
            <Save size={16} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

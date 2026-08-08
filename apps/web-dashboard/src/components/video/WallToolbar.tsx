/**
 * WallToolbar — the top control bar of the video wall.
 *
 * Renders the 6 HikCentral-style division presets (1/4/9/16/36/64), plus the
 * spotlight toggle, whole-wall fullscreen, round-robin rotation toggle, the
 * live-cap indicator, the saved-wall loader, and a "simulate alert pop-in"
 * demo button (10 §9.3 alert-driven pop-in).
 */
import { AlertTriangle, LayoutGrid, Maximize, Pause, Pin, Play, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { VideoWall, WallDivision } from '@/types/video.types';
import { WALL_DIVISIONS } from '@/types/video.types';
import {
  Box,
  Button,
  ButtonGroup,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from '@mui/material';

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
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
        px: 1.5,
        py: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
      }}
    >
      <Typography variant="h6" sx={{ fontSize: '1rem', mr: 1 }}>
        {t('video.title')}
      </Typography>

      {/* Division presets */}
      <ButtonGroup size="small" variant="outlined">
        {WALL_DIVISIONS.map((d) => (
          <Button
            key={d}
            onClick={() => onDivisionChange(d)}
            variant={division === d ? 'contained' : 'outlined'}
            sx={{ minWidth: 44, fontWeight: 600 }}
          >
            {d}
          </Button>
        ))}
      </ButtonGroup>

      <Chip
        size="small"
        icon={<LayoutGrid size={14} />}
        label={`${liveCount} / ${assignedCount} ${t('video.toolbar.live')}`}
        variant="outlined"
        sx={{ height: 24 }}
      />
      {assignedCount > maxLive && (
        <Tooltip title={`${t('video.toolbar.capHelp')} ${maxLive}`}>
          <Chip
            size="small"
            label={`${maxLive} ${t('video.toolbar.cap')}`}
            color="warning"
            variant="outlined"
            sx={{ height: 24 }}
          />
        </Tooltip>
      )}

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      {/* Spotlight */}
      <Tooltip title={t('video.toolbar.spotlight')}>
        <IconButton
          size="small"
          color={spotlightSlot !== null ? 'primary' : 'default'}
          onClick={onToggleSpotlight}
        >
          <Pin size={18} fill={spotlightSlot !== null ? 'currentColor' : 'none'} />
        </IconButton>
      </Tooltip>

      {/* Rotation toggle */}
      <Tooltip
        title={rotationOn ? t('video.toolbar.pauseRotation') : t('video.toolbar.resumeRotation')}
      >
        <IconButton
          size="small"
          onClick={onToggleRotation}
          color={rotationOn ? 'primary' : 'default'}
        >
          {rotationOn ? <Pause size={18} /> : <Play size={18} />}
        </IconButton>
      </Tooltip>

      {/* Fullscreen wall */}
      <Tooltip title={t('video.toolbar.fullscreenWall')}>
        <IconButton size="small" onClick={onFullscreenWall}>
          <Maximize size={18} />
        </IconButton>
      </Tooltip>

      {/* Simulate alert (demo) */}
      <Tooltip title={t('video.toolbar.simulateAlert')}>
        <IconButton size="small" color="warning" onClick={onSimulateAlert}>
          <AlertTriangle size={18} />
        </IconButton>
      </Tooltip>

      <Box sx={{ flex: 1 }} />

      {/* Saved walls */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {wallsLoading ? (
          <CircularProgress size={16} />
        ) : (
          <Select
            size="small"
            value=""
            displayEmpty
            onChange={(e) => {
              const w = walls?.find((x) => x.id === e.target.value);
              if (w) onLoadWall(w);
            }}
            sx={{ height: 30, fontSize: '0.8rem', minWidth: 150 }}
            renderValue={() => t('video.toolbar.loadWall')}
          >
            {(walls ?? []).map((w) => (
              <MenuItem key={w.id} value={w.id}>
                {w.name} ({w.division})
              </MenuItem>
            ))}
          </Select>
        )}
        <Tooltip title={t('video.toolbar.saveWall')}>
          <IconButton size="small" onClick={onSaveWall}>
            <Save size={16} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

import { Box, IconButton, MenuItem, Select, Stack, Tooltip, Typography } from '@mui/material';
import { Clock, Map as MapIcon, Pause, Play, Route, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { HISTORY_PRESETS, type HistoryPresetId } from '@/api/map.api';
import { LiveBadge } from '@/components/dashboard/LiveBadge';

interface MapToolbarProps {
  /** Number of vehicles currently visible (after filtering). */
  visibleCount: number;
  /** Total fleet size. */
  total: number;
  /** Whether live updates are paused (UI_UX_Design.md §2.7). */
  paused: boolean;
  onTogglePause: () => void;
  /** Tracking mode (Sprint F §20): LIVE = WebSocket deltas, HISTORY = API query. */
  mode: 'live' | 'history';
  onModeChange: (mode: 'live' | 'history') => void;
  /** Selected history window preset (history mode only). */
  historyPreset: HistoryPresetId;
  onHistoryPresetChange: (preset: HistoryPresetId) => void;
  /** Whether a vehicle is selected (history requires one). */
  hasSelection: boolean;
  /** Open the route planner (Sprint F §12). */
  onOpenRoutePlanner: () => void;
}

/**
 * MapToolbar — top overlay strip over the map.
 *
 * Page title + live freshness badge + visible-of-total vehicle count + a
 * "pause live" toggle that freezes the map for inspection (§2.7). Sprint F
 * §20: a LIVE/HISTORY mode switch (history renders the selected vehicle's
 * real track for a bounded preset window) and a route-planner entry point.
 */
export function MapToolbar({
  visibleCount,
  total,
  paused,
  onTogglePause,
  mode,
  onModeChange,
  historyPreset,
  onHistoryPresetChange,
  hasSelection,
  onOpenRoutePlanner,
}: MapToolbarProps) {
  const { t } = useTranslation();
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      gap={1}
      sx={{
        position: 'absolute',
        top: 8,
        start: 8,
        end: 8,
        zIndex: 1,
        backgroundColor: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(6px)',
        borderRadius: 1.5,
        px: 1.5,
        py: 0.75,
        pointerEvents: 'auto',
        boxShadow: '0px 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <Stack direction="row" alignItems="center" gap={1}>
        <Typography variant="subtitle1" fontWeight={700}>
          {t('map.title')}
        </Typography>
        {mode === 'live' && paused ? (
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            {t('map.paused')}
          </Typography>
        ) : mode === 'live' ? (
          <LiveBadge />
        ) : (
          <Typography
            variant="caption"
            fontWeight={600}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <Clock size={13} />
            {t('map.history.mode')}
          </Typography>
        )}
      </Stack>

      <Stack direction="row" alignItems="center" gap={1.5}>
        {/* §20 LIVE/HISTORY mode switch. */}
        <Stack direction="row" alignItems="center" gap={0.5}>
          <IconButton
            size="small"
            onClick={() => onModeChange('live')}
            aria-label={t('map.history.liveMode')}
            aria-pressed={mode === 'live'}
            sx={{ border: 1, borderColor: 'divider' }}
          >
            <Box component={MapIcon} size={16} />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => onModeChange('history')}
            aria-label={t('map.history.historyMode')}
            aria-pressed={mode === 'history'}
            disabled={false}
            sx={{ border: 1, borderColor: 'divider' }}
          >
            <Box component={Clock} size={16} />
          </IconButton>
        </Stack>

        {/* History window preset (bounded ranges — Sprint F §21). */}
        {mode === 'history' && (
          <Select
            size="small"
            value={historyPreset}
            onChange={(e) => onHistoryPresetChange(e.target.value as HistoryPresetId)}
            aria-label={t('map.history.range')}
            sx={{ minWidth: 96, '& .MuiSelect-select': { py: 0.5 } }}
          >
            {HISTORY_PRESETS.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {t(`map.history.preset.${p.id}`)}
              </MenuItem>
            ))}
          </Select>
        )}
        {mode === 'history' && !hasSelection && (
          <Typography variant="caption" color="warning.main">
            {t('map.history.selectVehicle')}
          </Typography>
        )}

        <Stack direction="row" alignItems="center" gap={0.5}>
          <Users size={15} color="var(--mui-palette-text-secondary)" />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {t('map.fleet', { shown: visibleCount, total })}
          </Typography>
        </Stack>

        <Tooltip title={t('map.route.planner')}>
          <IconButton size="small" onClick={onOpenRoutePlanner} aria-label={t('map.route.planner')}>
            <Box component={Route} size={18} />
          </IconButton>
        </Tooltip>

        {mode === 'live' && (
          <Tooltip title={paused ? t('map.resumeLive') : t('map.pauseLive')}>
            <IconButton
              size="small"
              onClick={onTogglePause}
              aria-label={paused ? t('map.resumeLive') : t('map.pauseLive')}
              aria-pressed={paused}
            >
              <Box component={paused ? Play : Pause} size={18} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}

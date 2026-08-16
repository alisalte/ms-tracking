import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Clock, Map as MapIcon, Pause, Play, Route, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HISTORY_PRESETS, type HistoryPresetId } from '@/api/map.api';
import { LiveBadge } from '@/components/dashboard/LiveBadge';

/** Custom [from, to] ISO window (Sprint I §29 — date/time range). */
export interface CustomRange {
  readonly from: string;
  readonly to: string;
}

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
  /** Selected history window preset (history mode only; 'custom' = range). */
  historyPreset: HistoryPresetId | 'custom';
  onHistoryPresetChange: (preset: HistoryPresetId | 'custom') => void;
  /** The active custom range (when preset === 'custom'). */
  customRange: CustomRange | null;
  onCustomRangeChange: (range: CustomRange | null) => void;
  /** Whether a vehicle is selected (history requires one). */
  hasSelection: boolean;
  /** Open the route planner (Sprint F §12). */
  onOpenRoutePlanner: () => void;
  /** Map matching enabled (Sprint I §38) — best-effort OSRM snapping. */
  mapMatching: boolean;
  onMapMatchingChange: (enabled: boolean) => void;
}

/** datetime-local value ↔ ISO (local timezone, as typed by the user). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * MapToolbar — top overlay strip over the map.
 *
 * Page title + live freshness badge + visible-of-total vehicle count + a
 * "pause live" toggle that freezes the map for inspection (§2.7). Sprint F
 * §20: a LIVE/HISTORY mode switch (history renders the selected vehicle's
 * real track for a bounded preset window) and a route-planner entry point.
 * Sprint I §29: history windows can be a CUSTOM from/to date-time range
 * (validated from < to, bounded by the backend's max range). Sprint I §38:
 * a map-matching toggle for history tracks (falls back to raw GPS + a chip).
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
  customRange,
  onCustomRangeChange,
  hasSelection,
  onOpenRoutePlanner,
  mapMatching,
  onMapMatchingChange,
}: MapToolbarProps) {
  const { t } = useTranslation();
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');

  // Seed the inputs when switching into custom mode.
  useEffect(() => {
    if (mode === 'history' && historyPreset === 'custom') {
      if (customRange) {
        setFromInput(isoToLocalInput(customRange.from));
        setToInput(isoToLocalInput(customRange.to));
      } else {
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 86_400_000);
        setFromInput(isoToLocalInput(dayAgo.toISOString()));
        setToInput(isoToLocalInput(now.toISOString()));
      }
    }
  }, [mode, historyPreset, customRange]);

  const applyCustomRange = () => {
    const from = localInputToIso(fromInput);
    const to = localInputToIso(toInput);
    if (!from || !to || new Date(from) >= new Date(to)) return; // invalid — keep last
    onCustomRangeChange({ from, to });
  };

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
        flexWrap: 'wrap',
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

      <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
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

        {/* History window: presets OR custom from/to (Sprint I §29). */}
        {mode === 'history' && (
          <Select
            size="small"
            value={historyPreset}
            onChange={(e) => onHistoryPresetChange(e.target.value as HistoryPresetId | 'custom')}
            aria-label={t('map.history.range')}
            data-testid="history-preset-select"
            sx={{ minWidth: 96, '& .MuiSelect-select': { py: 0.5 } }}
          >
            {HISTORY_PRESETS.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {t(`map.history.preset.${p.id}`)}
              </MenuItem>
            ))}
            <MenuItem value="custom">{t('map.history.customRange')}</MenuItem>
          </Select>
        )}
        {mode === 'history' && historyPreset === 'custom' && (
          <Stack direction="row" alignItems="center" gap={0.5}>
            <TextField
              type="datetime-local"
              size="small"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              aria-label={t('map.history.from')}
              slotProps={{ htmlInput: { 'aria-label': t('map.history.from') } }}
              sx={{ width: 205, '& input': { py: 0.5, fontSize: 13 } }}
            />
            <Typography variant="caption">→</Typography>
            <TextField
              type="datetime-local"
              size="small"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              aria-label={t('map.history.to')}
              slotProps={{ htmlInput: { 'aria-label': t('map.history.to') } }}
              sx={{ width: 205, '& input': { py: 0.5, fontSize: 13 } }}
            />
            <Button
              size="small"
              variant="contained"
              onClick={applyCustomRange}
              data-testid="history-load"
              aria-label={t('map.history.load')}
            >
              {t('map.history.load')}
            </Button>
          </Stack>
        )}
        {mode === 'history' && !hasSelection && (
          <Typography variant="caption" color="warning.main">
            {t('map.history.selectVehicle')}
          </Typography>
        )}

        {/* Sprint I §38 — map-matching toggle (graceful fallback to raw). */}
        {mode === 'history' && (
          <Tooltip title={t('map.matching.tooltip')}>
            <Button
              size="small"
              variant={mapMatching ? 'contained' : 'outlined'}
              onClick={() => onMapMatchingChange(!mapMatching)}
              aria-pressed={mapMatching}
              data-testid="map-matching-toggle"
              sx={{ textTransform: 'none' }}
            >
              {t('map.matching.toggle')}
            </Button>
          </Tooltip>
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

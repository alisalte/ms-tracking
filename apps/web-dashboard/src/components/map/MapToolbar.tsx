import { Clock, Map as MapIcon, Pause, Play, Route, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HISTORY_PRESETS, type HistoryPresetId } from '@/api/map.api';
import { LiveBadge } from '@/components/dashboard/LiveBadge';
import { Button, IconButton, ListboxSelect, Tooltip } from '@/components/tailwind-ui';

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
 * MapToolbar — TailAdmin top overlay strip over the map (Phase 5).
 *
 * Page title + live freshness badge + visible-of-total vehicle count + a
 * "pause live" toggle that freezes the map for inspection (§2.7). Sprint F
 * §20: a LIVE/HISTORY mode switch; Sprint I §29: custom from/to date-time
 * range; Sprint I §38: map-matching toggle with graceful fallback.
 *
 * The history-preset selector is a tailwind-ui ListboxSelect (WAI-ARIA
 * combobox/listbox) — the e2e suite opens it with a real click and picks
 * `role="option"` entries. Everything is Tailwind.
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
    <div className="pointer-events-auto absolute top-2 start-2 end-2 z-[1] flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur-md dark:bg-graydark-300/90">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">{t('map.title')}</h1>
        {mode === 'live' && paused ? (
          <span className="text-xs font-semibold text-gray-500 dark:text-graydark-600">
            {t('map.paused')}
          </span>
        ) : mode === 'live' ? (
          <LiveBadge />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-graydark-700">
            <Clock size={13} aria-hidden />
            {t('map.history.mode')}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* §20 LIVE/HISTORY mode switch. */}
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            variant="outline"
            onClick={() => onModeChange('live')}
            aria-label={t('map.history.liveMode')}
            aria-pressed={mode === 'live'}
          >
            <MapIcon size={15} />
          </IconButton>
          <IconButton
            size="sm"
            variant="outline"
            onClick={() => onModeChange('history')}
            aria-label={t('map.history.historyMode')}
            aria-pressed={mode === 'history'}
          >
            <Clock size={15} />
          </IconButton>
        </div>

        {/* History window: presets OR custom from/to (Sprint I §29). The
            listbox combobox keeps the e2e `role="option"` click gesture. */}
        {mode === 'history' && (
          <ListboxSelect
            value={historyPreset}
            onChange={(v) => onHistoryPresetChange(v as HistoryPresetId | 'custom')}
            aria-label={t('map.history.range')}
            data-testid="history-preset-select"
            className="w-40"
            options={[
              ...HISTORY_PRESETS.map((p) => ({
                value: p.id,
                label: t(`map.history.preset.${p.id}`),
              })),
              { value: 'custom', label: t('map.history.customRange') },
            ]}
          />
        )}
        {mode === 'history' && historyPreset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input
              type="datetime-local"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              aria-label={t('map.history.from')}
              className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-[13px] text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
            />
            <span className="text-xs text-gray-400">→</span>
            <input
              type="datetime-local"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              aria-label={t('map.history.to')}
              className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-[13px] text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
            />
            <Button
              size="sm"
              onClick={applyCustomRange}
              data-testid="history-load"
              aria-label={t('map.history.load')}
            >
              {t('map.history.load')}
            </Button>
          </div>
        )}
        {mode === 'history' && !hasSelection && (
          <span className="text-xs font-medium text-warning-600 dark:text-warning-400">
            {t('map.history.selectVehicle')}
          </span>
        )}

        {/* Sprint I §38 — map-matching toggle (graceful fallback to raw). */}
        {mode === 'history' && (
          <Tooltip label={t('map.matching.tooltip')}>
            <Button
              size="sm"
              variant={mapMatching ? 'primary' : 'outline'}
              onClick={() => onMapMatchingChange(!mapMatching)}
              aria-pressed={mapMatching}
              data-testid="map-matching-toggle"
            >
              {t('map.matching.toggle')}
            </Button>
          </Tooltip>
        )}

        <div className="flex items-center gap-1.5">
          <Users size={15} aria-hidden className="text-gray-400 dark:text-graydark-600" />
          <span className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
            {t('map.fleet', { shown: visibleCount, total })}
          </span>
        </div>

        <Tooltip label={t('map.route.planner')}>
          <IconButton size="sm" onClick={onOpenRoutePlanner} aria-label={t('map.route.planner')}>
            <Route size={17} />
          </IconButton>
        </Tooltip>

        {mode === 'live' && (
          <Tooltip label={paused ? t('map.resumeLive') : t('map.pauseLive')}>
            <IconButton
              size="sm"
              onClick={onTogglePause}
              aria-label={paused ? t('map.resumeLive') : t('map.pauseLive')}
              aria-pressed={paused}
            >
              {paused ? <Play size={17} /> : <Pause size={17} />}
            </IconButton>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

import { Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { PRESENCE_COLORS } from '@/lib/map-markers';
import { lastSeenLabel } from '@/lib/relative-time';
import type { Fleet } from '@/types/asset.types';
import type { MapVehicle } from '@/types/fleet.types';
import { PRESENCE_FILTERS, type PresenceFilter, presenceLabelKey, presenceOf } from './types';

interface DeviceListPanelProps {
  /** The (already-filtered) fleet to list. */
  vehicles: MapVehicle[];
  /** Total fleet size (before filtering) for the "showing N of M" caption. */
  total: number;
  /** Current search query. */
  query: string;
  /** Active presence filter (§18/§20). */
  presence: PresenceFilter;
  /** Counts per presence facet for the chip badges. */
  counts: Record<PresenceFilter, number>;
  /** Fleet registry for the fleet filter (§20); empty → selector hidden. */
  fleets: Fleet[];
  /** Selected fleet id, or 'all'. */
  fleetId: string;
  selectedId?: string | null;
  onQueryChange: (q: string) => void;
  onPresenceChange: (s: PresenceFilter) => void;
  onFleetChange: (fleetId: string) => void;
  onSelect: (id: string) => void;
}

/**
 * DeviceListPanel — TailAdmin left panel (Phase 5): search + fleet/presence
 * filters + the scrollable device roster.
 *
 * UI_UX_Design.md §2.2 + Sprint E §18–§20: rows carry the REAL connection
 * presence (ONLINE/OFFLINE/STALE/UNKNOWN) and the backend last-seen time
 * ("never" when there is no status record). Clicking a device selects it on
 * the map and opens the detail drawer; the selected row scrolls into view.
 * The fleet selector is a native `<select>` (combobox + option roles).
 */
export function DeviceListPanel({
  vehicles,
  total,
  query,
  presence,
  counts,
  fleets,
  fleetId,
  selectedId,
  onQueryChange,
  onPresenceChange,
  onFleetChange,
  onSelect,
}: DeviceListPanelProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the selected row visible as the selection changes.
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-vehicle-id="${selectedId}"]`);
    // scrollIntoView is absent in some test environments (jsdom) — guard it.
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <div className="flex h-full flex-col border-e border-gray-200 bg-white dark:border-white/5 dark:bg-graydark-300">
      {/* ── Search ── */}
      <div className="mx-2.5 mt-2.5 flex items-center gap-2 rounded-lg bg-gray-100 px-2.5 py-1.5 transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500/30 dark:bg-white/5 dark:focus-within:bg-graydark-300">
        <Search size={15} aria-hidden className="shrink-0 text-gray-400 dark:text-graydark-600" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('map.searchPlaceholder')}
          aria-label={t('map.search')}
          className="h-6 w-full min-w-0 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-graydark-800 dark:placeholder:text-graydark-600"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label={t('map.clearSearch')}
            className="flex shrink-0 cursor-pointer border-none bg-transparent p-0 text-gray-400 hover:text-gray-600 dark:hover:text-graydark-700"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* ── Fleet filter (§20) — registry fleets; authorization is server-side ── */}
      {fleets.length > 0 && (
        <select
          value={fleetId}
          onChange={(e) => onFleetChange(e.target.value)}
          aria-label={t('map.filters.fleet')}
          className="mx-2.5 mt-2 mb-1 h-8 cursor-pointer rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          <option value="all">{t('map.filters.allFleets')}</option>
          {fleets.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      )}

      {/* ── Presence filter chips (§18) ── */}
      <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
        {PRESENCE_FILTERS.map((s) => {
          const active = presence === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onPresenceChange(s)}
              aria-pressed={active}
              className={`h-6 cursor-pointer rounded-full border px-2.5 text-xs font-semibold transition-colors ${
                active
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5'
              }`}
            >
              {s === 'all'
                ? t(presenceLabelKey(s))
                : `${t(presenceLabelKey(s))} · ${counts[s] ?? 0}`}
            </button>
          );
        })}
      </div>

      <p className="px-4 pb-1 text-xs text-gray-500 dark:text-graydark-600">
        {t('map.list.count', { shown: vehicles.length, total })}
      </p>

      {/* ── Scrollable device list ── */}
      <div ref={listRef} className="fv-scroll min-h-0 flex-1 overflow-y-auto">
        {vehicles.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-500 dark:text-graydark-600">
            {t('map.noResults')}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {vehicles.map((v) => {
              const selected = v.id === selectedId;
              const p = presenceOf(v);
              return (
                <li key={v.id} data-vehicle-id={v.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(v.id)}
                    aria-pressed={selected}
                    className={`flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent p-0 text-start transition-colors ${
                      selected
                        ? 'border-s-4 border-s-brand-500 bg-brand-50 dark:bg-brand-500/10'
                        : 'border-s-4 border-s-transparent hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                    style={{
                      paddingBlock: 8,
                      paddingInline: selected ? 11 : 15,
                      borderInlineStartWidth: 4,
                      borderInlineStartStyle: 'solid',
                      borderInlineStartColor: selected ? 'var(--color-brand-500)' : 'transparent',
                    }}
                  >
                    <span
                      title={t(`map.presence.${p}`)}
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PRESENCE_COLORS[p] }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold tabular-nums text-gray-800 dark:text-graydark-800">
                        {v.label}
                      </span>
                      <span className="block truncate text-xs text-gray-500 dark:text-graydark-600">
                        {t('map.lastSeen.label')}: {lastSeenLabel(v.lastSeenAt, t)}
                      </span>
                    </span>
                    <span className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
                      {v.speed} km/h
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Legend footnote (§18) — color always paired with a text label (§0.7). */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-200 px-2.5 py-2 dark:border-white/5">
        {PRESENCE_FILTERS.filter((s) => s !== 'all').map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: PRESENCE_COLORS[s] }}
            />
            <span className="text-xs text-gray-500 dark:text-graydark-600">
              {t(presenceLabelKey(s))}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

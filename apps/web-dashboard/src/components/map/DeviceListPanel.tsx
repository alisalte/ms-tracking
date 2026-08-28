import { Bus, Car, Caravan, Clock, Compass, Gauge, Power, Search, Truck } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ListboxSelect } from '@/components/tailwind-ui';
import { PRESENCE_COLORS } from '@/lib/map-markers';
import { lastSeenLabel } from '@/lib/relative-time';
import type { Fleet } from '@/types/asset.types';
import type { MapVehicle, VehicleType } from '@/types/fleet.types';
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
  /** vehicleId → fleet NAME resolver (registry join) for the card subtitle. */
  fleetNameOf: (vehicleId: string) => string | undefined;
  selectedId?: string | null;
  onQueryChange: (q: string) => void;
  onPresenceChange: (s: PresenceFilter) => void;
  onFleetChange: (fleetId: string) => void;
  onSelect: (id: string) => void;
}

/** Vehicle-type icon (registry `type` → body shape). */
function VehicleTypeIcon({ type }: { type?: VehicleType }) {
  switch (type) {
    case 'truck':
      return <Truck />;
    case 'bus':
      return <Bus />;
    case 'van':
      return <Caravan />;
    default:
      return <Car />;
  }
}

/** Tonal tone per motion state (icon chip + state pill), glass-panel palette. */
function stateTone(state: MapVehicle['state']): { chip: string; icon: string; pill: string } {
  switch (state) {
    case 'driving':
      return {
        chip: 'bg-brand-500 text-white',
        pill: 'bg-brand-500/25 text-white ring-1 ring-brand-400/40',
        icon: 'bg-brand-500/90 text-white',
      };
    case 'overspeed':
      return {
        chip: 'bg-danger-500/25 text-danger-300',
        pill: 'bg-danger-500/25 text-danger-200 ring-1 ring-danger-400/40',
        icon: 'bg-danger-500/85 text-white',
      };
    case 'idle':
      return {
        chip: 'bg-warning-500/20 text-warning-300',
        pill: 'bg-warning-500/15 text-warning-200 ring-1 ring-warning-400/35',
        icon: 'bg-warning-500/80 text-white',
      };
    default:
      return {
        chip: 'bg-white/10 text-white/60',
        pill: 'bg-white/10 text-white/70 ring-1 ring-white/15',
        icon: 'bg-white/10 text-white/60',
      };
  }
}

/** Presence dot — the §18 color always paired with a text label elsewhere. */
function PresenceDot({ presence }: { presence: ReturnType<typeof presenceOf> }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: PRESENCE_COLORS[presence] }}
    />
  );
}

/**
 * DeviceListPanel — Tailwind left fleet roster for the Live Tracking map
 * (ported off MUI; keeps the always-dark "ops room" glass identity).
 *
 * Search → fleet select → presence filter chips → rich vehicle cards:
 * vehicle-type icon in a state tonal chip, label + fleet/driver secondary
 * line, a motion-state pill, and a compact meta strip (speed · ignition ·
 * heading · last seen). Selection highlights the card and scrolls it into
 * view (§17 list ↔ map sync).
 */
export function DeviceListPanel({
  vehicles,
  total,
  query,
  presence,
  counts,
  fleets,
  fleetId,
  fleetNameOf,
  selectedId,
  onQueryChange,
  onPresenceChange,
  onFleetChange,
  onSelect,
}: DeviceListPanelProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement | null>(null);

  // Keep the selected row visible as the selection changes.
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-vehicle-id="${selectedId}"]`);
    // scrollIntoView is absent in some test environments (jsdom) — guard it.
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const cards = useMemo(() => vehicles.map((v) => ({ v, p: presenceOf(v) })), [vehicles]);

  return (
    <div className="fv-dark-glass flex h-full flex-col overflow-hidden rounded-2xl bg-gray-950/80 text-white/90 shadow-2xl backdrop-blur-[28px] backdrop-saturate-140">
      {/* ── Search ── */}
      <div className="px-3 pt-3">
        <label className="relative block">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-white/45"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('map.searchPlaceholder')}
            aria-label={t('map.search')}
            className="h-9 w-full rounded-full border border-white/14 bg-white/6 ps-9 pe-3 text-sm text-white/90 placeholder:text-white/45 transition-colors hover:border-white/25 focus:border-white/40 focus:ring-2 focus:ring-white/20 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>

      {/* ── Fleet filter (§20) — registry fleets; authorization is server-side ── */}
      {fleets.length > 0 && (
        <div className="px-3 pt-2">
          <ListboxSelect
            tone="onGlass"
            value={fleetId}
            onChange={onFleetChange}
            aria-label={t('map.filters.fleet')}
            options={[
              { value: 'all', label: t('map.filters.allFleets') },
              ...fleets.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
        </div>
      )}

      {/* ── Presence filter (§18) — exclusive chips with counts ── */}
      <div className="flex flex-wrap gap-1 px-3 py-2">
        {PRESENCE_FILTERS.map((s) => {
          const active = presence === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => onPresenceChange(s)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                active
                  ? 'bg-white/20 text-white ring-1 ring-white/20'
                  : 'bg-transparent text-white/60 hover:bg-white/8 hover:text-white'
              }`}
            >
              {s !== 'all' && <PresenceDot presence={s} />}
              {s === 'all'
                ? t(presenceLabelKey(s))
                : `${t(presenceLabelKey(s))} · ${counts[s] ?? 0}`}
            </button>
          );
        })}
      </div>

      <p className="px-4 pb-1 text-xs text-white/50">
        {t('map.list.count', { shown: vehicles.length, total })}
      </p>

      <div className="mx-3 border-t border-white/8" />

      {/* ── Scrollable vehicle cards ── */}
      <ul ref={listRef} className="fv-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {cards.length === 0 ? (
          <li className="p-4 text-center text-sm text-white/50">{t('map.noResults')}</li>
        ) : (
          cards.map(({ v, p }) => {
            const selected = v.id === selectedId;
            const tone = stateTone(v.state);
            return (
              <li key={v.id} data-vehicle-id={v.id} className="mb-1.5 last:mb-0">
                <button
                  type="button"
                  data-testid="map-vehicle-card"
                  aria-pressed={selected}
                  onClick={() => onSelect(v.id)}
                  className={`flex w-full cursor-pointer items-start gap-2.5 rounded-2xl p-2 text-start transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    selected ? 'bg-white/15 hover:bg-white/17' : 'bg-transparent hover:bg-white/6'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4.5 ${tone.icon}`}
                  >
                    <VehicleTypeIcon type={v.type} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-semibold text-white/95">
                        {v.name?.trim() || v.label}
                      </span>
                      <PresenceDot presence={p} />
                      <span
                        className={`ms-auto inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] leading-4.5 font-semibold ${tone.pill}`}
                      >
                        {t(`map.states.${v.state}`)}
                      </span>
                    </span>
                    <span className="truncate text-xs text-white/55">
                      {[
                        v.plate?.trim() && v.plate.trim() !== (v.name?.trim() || v.label)
                          ? v.plate.trim()
                          : null,
                        fleetNameOf(v.id) ?? t('map.list.noFleet'),
                        v.driver,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-white/55 [&_svg]:me-1 [&_svg]:size-3 [&_svg]:align-text-bottom">
                      <span className="inline-flex items-center gap-1">
                        <Gauge aria-hidden />
                        {v.speed} km/h
                      </span>
                      {v.ignitionOn !== undefined && (
                        <span
                          className={`inline-flex items-center gap-1 ${
                            v.ignitionOn ? 'text-success-400' : 'text-white/35'
                          }`}
                        >
                          <Power aria-hidden />
                          {t(v.ignitionOn ? 'map.popup.ignitionOn' : 'map.popup.ignitionOff')}
                        </span>
                      )}
                      <span
                        className="inline-flex items-center gap-1"
                        title={t('map.popup.heading')}
                      >
                        <Compass aria-hidden />
                        {v.heading}°
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock aria-hidden />
                        {lastSeenLabel(v.lastSeenAt, t)}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="mx-3 border-t border-white/8" />

      {/* Legend footnote (§18) — color always paired with a text label (§0.7). */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-3 py-2.5">
        {PRESENCE_FILTERS.filter((s) => s !== 'all').map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <PresenceDot presence={s} />
            <span className="text-xs text-white/55">{t(presenceLabelKey(s))}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

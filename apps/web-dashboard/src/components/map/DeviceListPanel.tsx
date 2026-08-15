import { Box, Chip, InputBase, MenuItem, Select, Stack, Typography } from '@mui/material';
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
 * DeviceListPanel — left side panel: search + fleet/presence filters + the
 * scrollable device roster.
 *
 * UI_UX_Design.md §2.2 + Sprint E §18–§20: rows carry the REAL connection
 * presence (ONLINE/OFFLINE/STALE/UNKNOWN) and the backend last-seen time
 * ("never" when there is no status record). Clicking a device selects it on
 * the map and opens the detail drawer; the selected row scrolls into view.
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
    <Stack
      sx={{
        height: '100%',
        backgroundColor: 'background.paper',
        borderInlineEnd: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* ── Search ── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          m: 1.5,
          px: 1.25,
          py: 0.75,
          borderRadius: 1.5,
          backgroundColor: 'action.hover',
        }}
      >
        <Search size={16} color="var(--mui-palette-text-secondary)" />
        <InputBase
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('map.searchPlaceholder')}
          inputProps={{ 'aria-label': t('map.search') }}
          sx={{ flex: 1, fontSize: '0.875rem' }}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label={t('map.clearSearch')}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              display: 'flex',
              padding: 0,
            }}
          >
            <X size={15} color="var(--mui-palette-text-secondary)" />
          </button>
        )}
      </Box>

      {/* ── Fleet filter (§20) — registry fleets; authorization is server-side ── */}
      {fleets.length > 0 && (
        <Select
          size="small"
          value={fleetId}
          onChange={(e) => onFleetChange(e.target.value)}
          aria-label={t('map.filters.fleet')}
          sx={{ mx: 1.5, mb: 1, fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.625 } }}
        >
          <MenuItem value="all" sx={{ fontSize: '0.8rem' }}>
            {t('map.filters.allFleets')}
          </MenuItem>
          {fleets.map((f) => (
            <MenuItem key={f.id} value={f.id} sx={{ fontSize: '0.8rem' }}>
              {f.name}
            </MenuItem>
          ))}
        </Select>
      )}

      {/* ── Presence filter chips (§18) ── */}
      <Stack direction="row" gap={0.75} sx={{ px: 1.5, pb: 1, flexWrap: 'wrap' }}>
        {PRESENCE_FILTERS.map((s) => {
          const active = presence === s;
          return (
            <Chip
              key={s}
              size="small"
              label={
                s === 'all'
                  ? t(presenceLabelKey(s))
                  : `${t(presenceLabelKey(s))} · ${counts[s] ?? 0}`
              }
              onClick={() => onPresenceChange(s)}
              variant={active ? 'filled' : 'outlined'}
              color={active ? 'primary' : 'default'}
              sx={{
                height: 24,
                fontSize: '0.72rem',
                fontWeight: 600,
                textTransform: 'none',
              }}
            />
          );
        })}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 0.5 }}>
        {t('map.list.count', { shown: vehicles.length, total })}
      </Typography>

      {/* ── Scrollable device list ── */}
      <Box ref={listRef} sx={{ flex: 1, overflowY: 'auto' }}>
        {vehicles.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            {t('map.noResults')}
          </Typography>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {vehicles.map((v) => {
              const selected = v.id === selectedId;
              const p = presenceOf(v);
              return (
                <li key={v.id} data-vehicle-id={v.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(v.id)}
                    aria-pressed={selected}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'start',
                      padding: '8px 16px',
                      background: selected ? 'var(--mui-palette-action-selected)' : 'transparent',
                      border: 'none',
                      borderInlineStart: selected
                        ? '3px solid var(--mui-palette-primary-main)'
                        : '3px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <Box
                      component="span"
                      title={t(`map.presence.${p}`)}
                      sx={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        backgroundColor: PRESENCE_COLORS[p],
                        flexShrink: 0,
                        flex: '0 0 auto',
                      }}
                    />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        noWrap
                        sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {v.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="span">
                        {t('map.lastSeen.label')}: {lastSeenLabel(v.lastSeenAt, t)}
                      </Typography>
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {v.speed} km/h
                    </Typography>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Box>

      {/* Legend footnote (§18) — color always paired with a text label (§0.7). */}
      <Stack
        direction="row"
        gap={1.25}
        sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}
      >
        {PRESENCE_FILTERS.filter((s) => s !== 'all').map((s) => (
          <Stack key={s} direction="row" alignItems="center" gap={0.25}>
            <Box
              component="span"
              sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: PRESENCE_COLORS[s] }}
            />
            <Typography variant="caption" color="text.secondary">
              {t(presenceLabelKey(s))}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

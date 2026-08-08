import { Box, Chip, InputBase, Stack, Typography } from '@mui/material';
import { Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { vehicleColor } from '@/lib/map-markers';
import type { MapVehicle } from '@/types/fleet.types';
import { STATUS_FILTERS, type StatusFilter, statusLabelKey } from './types';

interface DeviceListPanelProps {
  /** The (already-filtered) fleet to list. */
  vehicles: MapVehicle[];
  /** Total fleet size (before filtering) for the "showing N of M" caption. */
  total: number;
  /** Current search query. */
  query: string;
  /** Active status filter. */
  status: StatusFilter;
  /** Counts per status facet for the chip badges. */
  counts: Record<StatusFilter, number>;
  selectedId?: string | null;
  onQueryChange: (q: string) => void;
  onStatusChange: (s: StatusFilter) => void;
  onSelect: (id: string) => void;
}

/**
 * DeviceListPanel — left side panel: search + status filters + scrollable device list.
 *
 * UI_UX_Design.md §2.2: a filterable fleet roster. Clicking a device selects it
 * on the map and opens the detail drawer. The selected row scrolls into view.
 */
export function DeviceListPanel({
  vehicles,
  total,
  query,
  status,
  counts,
  selectedId,
  onQueryChange,
  onStatusChange,
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
        borderRight: '1px solid',
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

      {/* ── Status filter chips ── */}
      <Stack direction="row" gap={0.75} sx={{ px: 1.5, pb: 1, flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map((s) => {
          const active = status === s;
          return (
            <Chip
              key={s}
              size="small"
              label={
                s === 'all' ? t(statusLabelKey(s)) : `${t(statusLabelKey(s))} · ${counts[s] ?? 0}`
              }
              onClick={() => onStatusChange(s)}
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
              return (
                <li key={v.id} data-vehicle-id={v.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(v.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'start',
                      padding: '8px 16px',
                      background: selected ? 'var(--mui-palette-action-selected)' : 'transparent',
                      border: 'none',
                      borderLeft: selected
                        ? '3px solid var(--mui-palette-primary-main)'
                        : '3px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        backgroundColor: vehicleColor(v),
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
                        {v.driver ?? t('map.popup.unassigned')}
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
    </Stack>
  );
}

import {
  AirportShuttle,
  DirectionsBus,
  DirectionsCar,
  Explore,
  LocalShipping,
  PowerSettingsNew,
  Schedule,
  Search,
  Speed,
} from '@mui/icons-material';
import {
  Avatar,
  Box,
  Chip,
  Divider,
  InputAdornment,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  MenuItem,
  OutlinedInput,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { ChipProps } from '@mui/material';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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

/** Vehicle-type icon (registry `type` → Material body shape). */
function VehicleTypeIcon({ type }: { type?: VehicleType }) {
  switch (type) {
    case 'truck':
      return <LocalShipping />;
    case 'bus':
      return <DirectionsBus />;
    case 'van':
      return <AirportShuttle />;
    default:
      return <DirectionsCar />;
  }
}

/** Material tonal tone per motion state (avatar + state chip). */
function stateTone(
  state: MapVehicle['state'],
  dark: boolean,
): { avatar: string; chip: ChipProps['color']; chipVariant: ChipProps['variant'] } {
  switch (state) {
    case 'driving':
      return { avatar: 'primary.main', chip: 'primary', chipVariant: 'filled' };
    case 'overspeed':
      return { avatar: dark ? 'error.dark' : 'error.light', chip: 'error', chipVariant: 'filled' };
    case 'idle':
      return { avatar: dark ? 'warning.dark' : 'warning.light', chip: 'warning', chipVariant: 'outlined' };
    default:
      return { avatar: dark ? 'grey.700' : 'grey.200', chip: 'default', chipVariant: 'outlined' };
  }
}

/** Presence dot — the §18 color always paired with a text label elsewhere. */
function PresenceDot({ presence }: { presence: ReturnType<typeof presenceOf> }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }}
      style={{ backgroundColor: PRESENCE_COLORS[presence] }}
    />
  );
}

/**
 * DeviceListPanel — Material (MUI) left fleet roster for the Live Tracking map.
 *
 * Search → fleet select → presence ToggleButtons → an MUI List of rich
 * ListItemButtons: vehicle-type Avatar in a state tonal color, label +
 * fleet/driver secondary line, a motion-state Chip, and a compact meta strip
 * (speed · ignition · heading · last seen). Selection highlights the item and
 * scrolls it into view (§17 list ↔ map sync).
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
    <Box
      className="fv-dark-glass"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 3,
        bgcolor: 'rgba(17,24,39,0.80)',
        backdropFilter: 'blur(28px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.4)',
        color: 'rgba(255,255,255,0.92)',
      }}
    >
      {/* ── Search ── */}
      <Box sx={{ px: 1.5, pt: 1.5 }}>
        <OutlinedInput
          size="small"
          fullWidth
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('map.searchPlaceholder')}
          aria-label={t('map.search')}
          startAdornment={
            <InputAdornment position="start">
              <Search fontSize="small" />
            </InputAdornment>
          }
          sx={{ borderRadius: 999, bgcolor: 'action.hover' }}
        />
      </Box>

      {/* ── Fleet filter (§20) — registry fleets; authorization is server-side ── */}
      {fleets.length > 0 && (
        <Box sx={{ px: 1.5, pt: 1 }}>
          <TextField
            select
            size="small"
            fullWidth
            value={fleetId}
            onChange={(e) => onFleetChange(e.target.value)}
            aria-label={t('map.filters.fleet')}
            sx={{ '& .MuiSelect-select': { fontSize: 13 } }}
          >
            <MenuItem value="all">{t('map.filters.allFleets')}</MenuItem>
            {fleets.map((f) => (
              <MenuItem key={f.id} value={f.id}>
                {f.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}

      {/* ── Presence filter (§18) — exclusive ToggleButtons with counts ── */}
      <Box sx={{ px: 1.5, py: 1 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={presence}
          onChange={(_, v) => {
            if (v !== null) onPresenceChange(v as PresenceFilter);
          }}
          aria-label={t('map.filters.all')}
          sx={{ flexWrap: 'wrap', gap: 0.5, '& .MuiToggleButton-root': { border: 0, borderRadius: 999, px: 1.25, py: 0.25, fontSize: 12, fontWeight: 600 } }}
        >
          {PRESENCE_FILTERS.map((s) => (
            <ToggleButton
              key={s}
              value={s}
              aria-pressed={presence === s}
              color={s === 'all' ? 'standard' : 'primary'}
            >
              {s === 'all' ? t(presenceLabelKey(s)) : `${t(presenceLabelKey(s))} · ${counts[s] ?? 0}`}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <Typography variant="caption" sx={{ px: 2, pb: 0.5, color: 'text.secondary' }}>
        {t('map.list.count', { shown: vehicles.length, total })}
      </Typography>

      <Divider />

      {/* ── Scrollable vehicle cards ── */}
      <List
        ref={listRef}
        disablePadding
        sx={{ minHeight: 0, flex: 1, overflowY: 'auto', px: 1, py: 1 }}
      >
        {cards.length === 0 ? (
          <Typography variant="body2" sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
            {t('map.noResults')}
          </Typography>
        ) : (
          cards.map(({ v, p }) => {
            const selected = v.id === selectedId;
            const tone = stateTone(v.state, true);
            return (
              <ListItem
                key={v.id}
                data-vehicle-id={v.id}
                disablePadding
                sx={{ mb: 0.5, borderRadius: 2 }}
                secondaryAction={
                  <Chip
                    label={t(`map.states.${v.state}`)}
                    color={tone.chip}
                    variant={tone.chipVariant}
                    size="small"
                    sx={{ fontSize: 11, height: 22, fontWeight: 600, borderRadius: 999 }}
                  />
                }
              >
                <ListItemButton
                  component="button"
                  type="button"
                  data-testid="map-vehicle-card"
                  selected={selected}
                  onClick={() => onSelect(v.id)}
                  aria-pressed={selected}
                  sx={{
                    borderRadius: 999,
                    pr: 9,
                    alignItems: 'flex-start',
                    textAlign: 'start',
                    py: 0.75,
                    // Material Dashboard signature: the active list item is a
                    // soft brand-tinted pill.
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
                    '&.Mui-selected': {
                      bgcolor: 'rgba(255,255,255,0.13)',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.17)' },
                    },
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 44 }}>
                    <Avatar
                      sx={{
                        width: 34,
                        height: 34,
                        bgcolor: tone.avatar,
                        color: v.state === 'driving' ? '#fff' : undefined,
                      }}
                    >
                      {<VehicleTypeIcon type={v.type} />}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography component="span" variant="body2" noWrap sx={{ fontWeight: 600 }}>
                          {v.label}
                        </Typography>
                        <PresenceDot presence={p} />
                      </Box>
                    }
                    secondary={
                      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        <Typography
                          component="span"
                          variant="caption"
                          noWrap
                          sx={{ display: 'block' }}
                        >
                          {fleetNameOf(v.id) ?? t('map.list.noFleet')}
                          {v.driver ? ` · ${v.driver}` : ''}
                        </Typography>
                        <Box
                          component="span"
                          sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 1.25,
                            color: 'text.secondary',
                            '& svg': { fontSize: 13, verticalAlign: 'text-bottom', me: 0.25 },
                          }}
                        >
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                            <Speed fontSize="inherit" />
                            {v.speed} km/h
                          </Box>
                          {v.ignitionOn !== undefined && (
                            <Box
                              component="span"
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 0.25,
                                color: v.ignitionOn ? 'success.main' : 'text.disabled',
                              }}
                            >
                              <PowerSettingsNew fontSize="inherit" />
                              {t(v.ignitionOn ? 'map.popup.ignitionOn' : 'map.popup.ignitionOff')}
                            </Box>
                          )}
                          <Box
                            component="span"
                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
                            title={t('map.popup.heading')}
                          >
                            <Explore fontSize="inherit" />
                            {v.heading}°
                          </Box>
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                            <Schedule fontSize="inherit" />
                            {lastSeenLabel(v.lastSeenAt, t)}
                          </Box>
                        </Box>
                      </Box>
                    }
                    slotProps={{ primary: { sx: { mb: 0 } } }}
                  />
                </ListItemButton>
              </ListItem>
            );
          })
        )}
      </List>

      <Divider />

      {/* Legend footnote (§18) — color always paired with a text label (§0.7). */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, px: 1.5, py: 1 }}>
        {PRESENCE_FILTERS.filter((s) => s !== 'all').map((s) => (
          <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <PresenceDot presence={s} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t(presenceLabelKey(s))}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

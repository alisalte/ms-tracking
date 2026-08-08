import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { Pause, Play, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LiveBadge } from '@/components/dashboard/LiveBadge';

interface MapToolbarProps {
  /** Number of vehicles currently visible (after filtering). */
  visibleCount: number;
  /** Total fleet size. */
  total: number;
  /** Whether live updates are paused (UI_UX_Design.md §2.7). */
  paused: boolean;
  onTogglePause: () => void;
}

/**
 * MapToolbar — top overlay strip over the map.
 *
 * Page title + live freshness badge + visible-of-total vehicle count + a
 * "pause live" toggle that freezes the map for inspection (§2.7).
 */
export function MapToolbar({ visibleCount, total, paused, onTogglePause }: MapToolbarProps) {
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
        {paused ? (
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            {t('map.paused')}
          </Typography>
        ) : (
          <LiveBadge />
        )}
      </Stack>

      <Stack direction="row" alignItems="center" gap={1.5}>
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
      </Stack>
    </Stack>
  );
}

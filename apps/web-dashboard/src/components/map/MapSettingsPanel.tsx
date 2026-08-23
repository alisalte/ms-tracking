import CheckIcon from '@mui/icons-material/Check';
import LayersIcon from '@mui/icons-material/Layers';
import { Box, Fab, MenuItem, MenuList, Popover, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BASEMAPS, type BasemapId } from '@/lib/basemaps';

interface MapSettingsPanelProps {
  /** Active basemap style id. */
  basemap: BasemapId;
  onBasemapChange: (basemap: BasemapId) => void;
}

/**
 * MapSettingsPanel — Material (MUI) floating map-settings control, kept
 * SEPARATE from the top tracking toolbar: a small Fab (layers icon) at the
 * bottom-start corner of the map opens a Popover with the basemap display
 * modes (streets / satellite / dark / topo).
 *
 * The option list is a WAI-ARIA radiogroup (each MenuItem carries role=radio
 * + aria-checked); the popover closes on outside click or Escape but stays
 * open on selection so modes can be flipped quickly.
 */
export function MapSettingsPanel({ basemap, onBasemapChange }: MapSettingsPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Outside-click close (the map canvas keeps receiving normal pans/zooms).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <Box
      ref={rootRef}
      sx={{ position: 'absolute', bottom: 12, insetInlineStart: 12, zIndex: 20 }}
    >
      <Fab
        size="small"
        color="default"
        aria-label={t('map.settings.open')}
        title={t('map.settings.open')}
        data-testid="map-settings-button"
        aria-expanded={open}
        onClick={(e) => {
          setAnchorEl(e.currentTarget);
          setOpen((o) => !o);
        }}
        sx={{
          boxShadow: 3,
          bgcolor: 'background.paper',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <LayersIcon fontSize="small" />
      </Fab>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        marginThreshold={16}
        slotProps={{
          paper: {
            sx: { borderRadius: 3, mt: -1, minWidth: 230, p: 1 },
          },
        }}
      >
        <Typography
          variant="overline"
          sx={{ display: 'block', px: 1, pt: 0.5, color: 'text.secondary' }}
        >
          {t('map.settings.basemap')}
        </Typography>
        <MenuList
          role="radiogroup"
          aria-label={t('map.settings.basemap')}
          data-testid="map-settings-popover"
          sx={{ pt: 0.5 }}
        >
          {BASEMAPS.map((bm) => {
            const active = bm.id === basemap;
            return (
              <MenuItem
                key={bm.id}
                role="radio"
                aria-checked={active}
                data-testid={`basemap-option-${bm.id}`}
                selected={active}
                onClick={() => onBasemapChange(bm.id)}
                sx={{ borderRadius: 2, gap: 1.25 }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 36,
                    height: 28,
                    borderRadius: 1.5,
                    flexShrink: 0,
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                  }}
                  className={`bg-gradient-to-br ${bm.swatchClass}`}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {t(bm.labelKey)}
                  </Typography>
                </Box>
                {active && <CheckIcon fontSize="small" color="primary" />}
              </MenuItem>
            );
          })}
        </MenuList>
      </Popover>
    </Box>
  );
}

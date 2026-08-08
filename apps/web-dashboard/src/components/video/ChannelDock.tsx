/**
 * ChannelDock — the collapsible left panel that lists all assignable channels.
 *
 * Groups channels by source (sites → site cameras, vehicles → 4 cameras each).
 * Clicking a channel assigns it to the next free wall slot. Includes a search
 * box, an online-only filter, and an auto-fill action that populates every
 * empty slot. Mirrors the channel-picker contract in `10_Live_Vide.md` §7.3.
 */
import { Building2, Camera, Search, Wand2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CameraChannel, CameraFacing } from '@/types/video.types';
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';

/** Facing → i18n key. */
const FACING_KEY: Record<CameraFacing, string> = {
  forward: 'video.facing.forward',
  driver: 'video.facing.driver',
  rear: 'video.facing.rear',
  cargo: 'video.facing.cargo',
  site: 'video.facing.site',
};

interface ChannelDockProps {
  /** The full channel catalog. */
  channels: CameraChannel[];
  /** Assign a channel to the next free slot. */
  onPick: (channel: CameraChannel) => void;
  /** Fill every empty slot with channels (deterministic order). */
  onAutoFill: () => void;
}

export function ChannelDock({ channels, onPick, onAutoFill }: ChannelDockProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => {
      if (onlineOnly && (!c.online || !c.consentGiven)) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.sourceLabel.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    });
  }, [channels, query, onlineOnly]);

  // Group by source label so the list is readable.
  const grouped = useMemo(() => {
    const m = new Map<string, CameraChannel[]>();
    for (const c of filtered) {
      const arr = m.get(c.sourceLabel) ?? [];
      arr.push(c);
      m.set(c.sourceLabel, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Stack
      sx={{
        width: 260,
        minWidth: 260,
        height: '100%',
        borderRight: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      {/* Header: search + actions */}
      <Stack gap={1} sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {t('video.dock.title')}
          </Typography>
          <Tooltip title={t('video.dock.onlineOnly')}>
            <Chip
              size="small"
              label={t('video.dock.online')}
              color={onlineOnly ? 'primary' : 'default'}
              variant={onlineOnly ? 'filled' : 'outlined'}
              onClick={() => setOnlineOnly((v) => !v)}
              sx={{ height: 22, fontSize: '0.7rem' }}
            />
          </Tooltip>
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: 0.5,
            borderRadius: 1,
            backgroundColor: 'action.hover',
          }}
        >
          <Search size={16} style={{ color: 'text.secondary' }} />
          <InputBase
            placeholder={t('video.dock.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ flex: 1, fontSize: '0.85rem' }}
            inputProps={{ 'aria-label': 'channel search' }}
          />
          {query && (
            <IconButton size="small" onClick={() => setQuery('')} aria-label="clear search">
              <X size={14} />
            </IconButton>
          )}
        </Box>
        <Button
          size="small"
          startIcon={<Wand2 size={16} />}
          onClick={onAutoFill}
          variant="outlined"
        >
          {t('video.dock.autoFill')}
        </Button>
      </Stack>

      {/* Channel list grouped by source */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {grouped.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ p: 2, display: 'block' }}>
            {t('video.dock.noResults')}
          </Typography>
        ) : (
          <List dense disablePadding>
            {grouped.map(([sourceLabel, cams]) => {
              const isCollapsed = collapsed.has(sourceLabel);
              return (
                <Box key={sourceLabel}>
                  <ListItemButton onClick={() => toggleGroup(sourceLabel)} sx={{ py: 0.5 }}>
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      {cams[0]?.sourceType === 'site' ? (
                        <Building2 size={16} />
                      ) : (
                        <Camera size={16} />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={sourceLabel}
                      primaryTypographyProps={{ variant: 'body2', fontWeight: 500, noWrap: true }}
                    />
                    <Chip
                      label={cams.length}
                      size="small"
                      sx={{ height: 16, fontSize: '0.6rem' }}
                    />
                  </ListItemButton>
                  <Collapse in={!isCollapsed} timeout="auto" unmountOnExit>
                    <List dense disablePadding>
                      {cams.map((c) => (
                        <ListItemButton
                          key={c.id}
                          onClick={() => onPick(c)}
                          sx={{ pl: 4, py: 0.25, opacity: c.online && c.consentGiven ? 1 : 0.5 }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: c.online && c.consentGiven ? '#22d3ee' : '#64748b',
                              display: 'inline-block',
                              marginRight: 8,
                              flexShrink: 0,
                            }}
                          />
                          <ListItemText
                            primary={t(FACING_KEY[c.facing])}
                            primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                          />
                          {c.cabinCam && (
                            <Chip
                              label={t('video.tile.cabinCam')}
                              size="small"
                              sx={{ height: 14, fontSize: '0.55rem' }}
                            />
                          )}
                        </ListItemButton>
                      ))}
                    </List>
                  </Collapse>
                </Box>
              );
            })}
          </List>
        )}
      </Box>
    </Stack>
  );
}

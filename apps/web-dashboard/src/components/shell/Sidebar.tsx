import { Box, Drawer, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, Truck } from 'lucide-react';
import { useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '@/hooks/useAuth';
import { sidebar as sidebarPalette } from '@/theme/palette';
import { NAV_GROUPS, filterNavByPermissions } from './nav.config';

/** Expanded sidebar width (Limitless default = 270px). */
export const SIDEBAR_WIDTH = 270;
/** Collapsed (mini) sidebar width (Limitless mini = 56px, icon-only). */
export const SIDEBAR_COLLAPSED_WIDTH = 64;

interface SidebarProps {
  /** Desktop: collapsed state. Mobile: open state. */
  mobileOpen: boolean;
  collapsed: boolean;
  onMobileClose: () => void;
  onToggleCollapse: () => void;
}

/**
 * Sidebar — the signature Limitless dark slate navigation drawer.
 *
 * Stays dark (`#263238`) in BOTH light and dark modes — the recognizable
 * Limitless Layout 1 silhouette. Limitless IA: grouped nav with uppercase
 * section labels on a darker strip; nav rows with icon + label, an active
 * accent bar + tinted background, and hover.
 *
 * Behavior:
 * - Desktop (≥lg): permanent drawer, 270px expanded / 64px collapsed (icons).
 * - Mobile (<lg): temporary off-canvas drawer (overlay), full 270px.
 */
export function Sidebar({ mobileOpen, collapsed, onMobileClose, onToggleCollapse }: SidebarProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const groups = filterNavByPermissions(NAV_GROUPS, user?.permissions ?? []);
  const currentPath = location.pathname;

  const handleNavigate = (path: string) => {
    navigate(path);
    onMobileClose();
  };

  // The inner content is shared between the desktop permanent drawer and the
  // mobile temporary drawer so they look identical.
  const content = (
    <Stack
      sx={{
        height: '100%',
        backgroundColor: sidebarPalette.bg,
        color: sidebarPalette.textStrong,
        borderInlineEnd: `1px solid ${sidebarPalette.border}`,
      }}
    >
      {/* Brand + collapse toggle (desktop only) */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent={collapsed ? 'center' : 'space-between'}
        sx={{
          height: 50,
          px: collapsed ? 0 : 2,
          borderBottom: `1px solid ${sidebarPalette.border}`,
        }}
      >
        {collapsed ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 1,
              background: 'linear-gradient(135deg, #2196F3 0%, #3F51B5 100%)',
            }}
          >
            <Truck size={18} color="#fff" />
          </Box>
        ) : (
          <Stack direction="row" alignItems="center" gap={1}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 1,
                background: 'linear-gradient(135deg, #2196F3 0%, #3F51B5 100%)',
                flexShrink: 0,
              }}
            >
              <Truck size={18} color="#fff" />
            </Box>
            <Typography
              sx={{
                fontWeight: 700,
                fontSize: '1rem',
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
              }}
            >
              FleetVision
            </Typography>
          </Stack>
        )}

        {/* Collapse toggle (hidden on mobile drawer / when collapsed via hover) */}
        <IconButton
          onClick={onToggleCollapse}
          aria-label={collapsed ? t('common.expandNav') : t('common.collapseNav')}
          sx={{
            display: { xs: 'none', lg: 'inline-flex' },
            color: sidebarPalette.text,
            '&:hover': { color: sidebarPalette.textStrong, backgroundColor: sidebarPalette.hover },
          }}
        >
          {theme.direction === 'rtl' ? (
            collapsed ? (
              <ChevronLeft size={18} />
            ) : (
              <ChevronRight size={18} />
            )
          ) : collapsed ? (
            <ChevronRight size={18} />
          ) : (
            <ChevronLeft size={18} />
          )}
        </IconButton>
      </Stack>

      {/* Navigation groups */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          py: 1,
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255,255,255,0.12)',
            borderRadius: 99,
          },
        }}
      >
        {groups.map((group, gi) => (
          <Stack key={group.groupKey ?? `g-${gi}`} sx={{ mb: 0.5 }}>
            {group.groupKey && !collapsed && (
              <Box
                sx={{
                  px: 2.5,
                  py: 1.25,
                  mt: gi === 0 ? 0 : 0.5,
                  borderTop: gi === 0 ? 'none' : `1px solid ${sidebarPalette.border}`,
                  borderBottom: `1px solid ${sidebarPalette.border}`,
                  backgroundColor: sidebarPalette.groupBg,
                }}
              >
                <Typography
                  variant="overline"
                  sx={{
                    color: sidebarPalette.textMuted,
                    lineHeight: 1.6667,
                    fontSize: '0.65rem',
                    letterSpacing: '0.08em',
                  }}
                >
                  {t(`navGroups.${group.groupKey}`)}
                </Typography>
              </Box>
            )}
            <Stack sx={{ px: 1, mt: group.groupKey ? 0.5 : 0, gap: 0.25 }}>
              {group.items.map((item) => {
                const isActive =
                  currentPath === item.path ||
                  (item.path !== '/dashboard' && currentPath.startsWith(item.path));
                const Icon = item.icon;
                const navButton = (
                  <Stack
                    component="button"
                    direction="row"
                    alignItems="center"
                    gap={1.5}
                    onClick={() => handleNavigate(item.path)}
                    sx={{
                      position: 'relative',
                      width: '100%',
                      border: 'none',
                      background: isActive ? sidebarPalette.active : 'transparent',
                      color: isActive ? sidebarPalette.textStrong : sidebarPalette.text,
                      cursor: 'pointer',
                      borderRadius: 1,
                      px: collapsed ? 0 : 1.5,
                      py: 1,
                      minHeight: 38,
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      transition: 'background-color 0.15s ease-in-out, color 0.15s ease-in-out',
                      '&:hover': {
                        backgroundColor: isActive ? sidebarPalette.active : sidebarPalette.hover,
                        color: sidebarPalette.textStrong,
                      },
                      // Active accent bar (block-start side for RTL awareness).
                      '&::before': isActive
                        ? {
                            content: '""',
                            position: 'absolute',
                            insetInlineStart: 0,
                            top: 6,
                            bottom: 6,
                            width: 3,
                            borderRadius: 99,
                            backgroundColor: sidebarPalette.accent,
                          }
                        : {},
                    }}
                  >
                    <Icon
                      size={18}
                      color={isActive ? sidebarPalette.accent : 'currentColor'}
                      style={{ flexShrink: 0 }}
                    />
                    {!collapsed && (
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          fontWeight: isActive ? 600 : 400,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t(`nav.${item.key}`)}
                      </Typography>
                    )}
                  </Stack>
                );
                return collapsed ? (
                  <Tooltip
                    key={item.key}
                    title={t(`nav.${item.key}`)}
                    placement="right"
                    disableInteractive
                  >
                    {navButton}
                  </Tooltip>
                ) : (
                  <Box key={item.key}>{navButton}</Box>
                );
              })}
            </Stack>
          </Stack>
        ))}
      </Box>

      {/* Footer version strip */}
      {!collapsed && (
        <Box
          sx={{
            px: 2.5,
            py: 1,
            borderTop: `1px solid ${sidebarPalette.border}`,
            color: sidebarPalette.textMuted,
          }}
        >
          <Typography variant="caption">FleetVision v0.1</Typography>
        </Box>
      )}
    </Stack>
  );

  return (
    <Box
      component="nav"
      sx={{
        flexShrink: { lg: 0 },
        width: { lg: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH },
        transition: (t) => t.transitions.create('width', { duration: 200 }),
      }}
    >
      {/* Mobile drawer (off-canvas overlay) */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', lg: 'none' },
          '& .MuiDrawer-paper': {
            width: SIDEBAR_WIDTH,
            boxSizing: 'border-box',
            border: 'none',
            backgroundImage: 'none',
          },
        }}
      >
        {content}
      </Drawer>

      {/* Desktop permanent drawer */}
      <Drawer
        variant="permanent"
        open
        sx={{
          display: { xs: 'none', lg: 'block' },
          '& .MuiDrawer-paper': {
            width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
            boxSizing: 'border-box',
            border: 'none',
            backgroundColor: sidebarPalette.bg,
            backgroundImage: 'none',
            overflowX: 'hidden',
            transition: (t) => t.transitions.create('width', { duration: 200 }),
          },
        }}
      >
        {content}
      </Drawer>
    </Box>
  );
}

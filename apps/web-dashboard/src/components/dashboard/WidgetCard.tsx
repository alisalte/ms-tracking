import { Card, CardContent, Skeleton, Stack, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useThemeContext } from '@/theme/ThemeRegistry';
import { glass } from '@/theme/palette';

import { LiveBadge } from './LiveBadge';

interface WidgetCardProps {
  /** i18n key for the widget title. */
  titleKey: string;
  /** Optional lucide icon rendered before the title. */
  icon?: LucideIcon;
  /** Show the live (pulsing) freshness badge in the header (UI_UX_Design.md §0.6). */
  live?: boolean;
  /** Optional header-right node (e.g. a time-range selector or "view all" link). */
  action?: ReactNode;
  /** While the underlying data is loading, render a skeleton body. */
  loading?: boolean;
  /** Empty-state message key rendered when `empty` is true. */
  emptyKey?: string;
  /** When true (and not loading), render the EmptyState instead of children. */
  empty?: boolean;
  children?: ReactNode;
  /** Optional extra sx for the card root. */
  sx?: object;
}

/**
 * Shared widget shell: a frosted-glass titled card with an optional live badge,
 * header action slot, and consistent loading (skeleton) + empty states.
 *
 * v5 (Glassmorphism): every dashboard card is a frosted-glass surface —
 * semi-transparent with a soft blur, a gradient highlight edge, a layered
 * shadow, and a sheen sweep on hover. The icon sits in a tinted glass badge.
 * Properties (titleKey/icon/live/action/loading/empty) are unchanged so all 8
 * dashboard widgets + ReportChart inherit the new look without edits.
 */
export function WidgetCard({
  titleKey,
  icon: Icon,
  live = false,
  action,
  loading = false,
  emptyKey,
  empty = false,
  children,
  sx,
}: WidgetCardProps) {
  const { t } = useTranslation();
  const { mode } = useThemeContext();
  const g = mode === 'dark' ? glass.dark : glass.light;

  return (
    <Card
      className="fv-glass fv-glass-edge fv-glass-sheen"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: glass.radius,
        backgroundColor: g.bg,
        border: `1px solid ${g.border}`,
        boxShadow: g.shadow,
        transition: 'box-shadow 0.25s ease, transform 0.25s ease, background-color 0.25s ease',
        '&:hover': {
          boxShadow: g.shadowHover,
          backgroundColor: g.hover,
          transform: 'translateY(-2px)',
        },
        // Keep the glass classes' shimmer/edge pseudo-elements visible.
        '&::before, &::after': { pointerEvents: 'none' },
        ...sx,
      }}
    >
      <CardContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          gap: 1.5,
          p: 2.25,
          '&:last-child': { pb: 2.25 },
          position: 'relative',
          zIndex: 3,
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Stack direction="row" alignItems="center" gap={1} minWidth={0}>
            {Icon && (
              <Stack
                alignItems="center"
                justifyContent="center"
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: glass.radiusSm,
                  background: g.highlight,
                  border: `1px solid ${g.border}`,
                  color: 'primary.main',
                  flexShrink: 0,
                }}
              >
                <Icon size={16} />
              </Stack>
            )}
            <Typography
              variant="subtitle2"
              fontWeight={700}
              noWrap
              sx={{ letterSpacing: '-0.01em' }}
            >
              {t(titleKey)}
            </Typography>
            {live && <LiveBadge />}
          </Stack>
          {action}
        </Stack>

        {loading ? (
          <Skeleton
            variant="rounded"
            sx={{ flex: 1, minHeight: 120, borderRadius: glass.radiusSm }}
          />
        ) : empty && emptyKey ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {t(emptyKey)}
          </Typography>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, Skeleton, Stack, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
 * Shared widget shell: a titled Limitless card with an optional live badge,
 * header action slot, and consistent loading (skeleton) + empty states.
 *
 * v3 (Limitless): weight-700 header, 20px body padding, near-flat 3px card
 * (sourced from the MuiCard theme override). Per UI_UX_Design.md §0.6, initial
 * load uses skeletons (not spinners) and the live badge is the pulsing freshness
 * dot reserved for real-time panels.
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
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      <CardContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          gap: 1.5,
          p: 2,
          '&:last-child': { pb: 2 },
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Stack direction="row" alignItems="center" gap={0.75} minWidth={0}>
            {Icon && <Icon size={17} style={{ flexShrink: 0 }} />}
            <Typography variant="subtitle2" fontWeight={700} noWrap>
              {t(titleKey)}
            </Typography>
            {live && <LiveBadge />}
          </Stack>
          {action}
        </Stack>

        {loading ? (
          <Skeleton variant="rounded" sx={{ flex: 1, minHeight: 120 }} />
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

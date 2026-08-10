import {
  Card,
  CardContent,
  type CardOwnProps,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { LiveBadge } from '@/components/dashboard/LiveBadge';

interface PanelProps extends CardOwnProps {
  /** i18n key for the panel title. */
  titleKey?: string;
  /** Already-translated title (takes precedence over titleKey). */
  title?: ReactNode;
  /** Optional lucide icon rendered before the title. */
  icon?: LucideIcon;
  /** Show the live (pulsing) freshness badge in the header. */
  live?: boolean;
  /** Header-right slot (time-range selector, "view all" link, actions). */
  action?: ReactNode;
  /** Body padding override (default 20px — Limitless card body). */
  bodyPadding?: number | string;
  /** While the underlying data is loading, render a skeleton body. */
  loading?: boolean;
  /** Empty-state message rendered when `empty` is true. */
  emptyKey?: string;
  /** When true (and not loading), render the empty message instead of children. */
  empty?: boolean;
  /** Render a divider between header and body. */
  divided?: boolean;
  /** Stretch to full height of the parent. */
  fullHeight?: boolean;
  /** Omit the header entirely (plain card). */
  bare?: boolean;
  children?: ReactNode;
}

/**
 * Panel — the Limitless card, the base titled surface of the design system.
 *
 * A titled MUI Card with an optional icon, live badge, header action slot, and
 * consistent loading (skeleton) + empty states. Replaces the ad-hoc titled-card
 * markup found across pages with one Limitless-faithful pattern: 3px radius,
 * near-flat shadow, white surface, 20px body padding, an optional divider under
 * the header.
 */
export function Panel({
  titleKey,
  title,
  icon: Icon,
  live = false,
  action,
  bodyPadding = 20,
  loading = false,
  emptyKey,
  empty = false,
  divided = false,
  fullHeight = false,
  bare = false,
  children,
  ...cardProps
}: PanelProps) {
  const { t } = useTranslation();
  const showHeader = !bare && Boolean(titleKey ?? title ?? action ?? (Icon || live));
  const header = showHeader ? (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      gap={1}
      sx={{ px: bodyPadding, pt: bodyPadding, pb: divided ? 1.5 : 0 }}
    >
      <Stack direction="row" alignItems="center" gap={0.75} minWidth={0}>
        {Icon && <Icon size={17} style={{ flexShrink: 0 }} />}
        {(title ?? (titleKey ? t(titleKey) : null)) && (
          <Typography variant="subtitle2" fontWeight={700} noWrap>
            {title ?? (titleKey ? t(titleKey) : '')}
          </Typography>
        )}
        {live && <LiveBadge />}
      </Stack>
      {action}
    </Stack>
  ) : null;

  return (
    <Card
      sx={{
        height: fullHeight ? '100%' : undefined,
        display: 'flex',
        flexDirection: 'column',
        ...cardProps.sx,
      }}
      {...cardProps}
    >
      {header}
      {divided && showHeader && <Divider />}
      <CardContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: fullHeight ? 1 : undefined,
          gap: 2,
          p: bare ? bodyPadding : bodyPadding,
          '&:last-child': { pb: bodyPadding },
        }}
      >
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

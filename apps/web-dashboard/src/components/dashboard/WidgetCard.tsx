import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
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
  /** Optional extra style for the card root (legacy MUI callers pass `sx`). */
  sx?: object;
  className?: string;
}

/**
<<<<<<< HEAD
 * Shared widget shell: a titled TailAdmin card with an optional live badge,
 * header action slot, and consistent loading (skeleton) + empty states.
 *
 * Tailwind version. Per UI_UX_Design.md §0.6, initial load uses skeletons (not
 * spinners) and the live badge is the pulsing freshness dot reserved for
 * real-time panels. Props mirror the legacy MUI WidgetCard so every consumer
 * (ActiveAlertsPanel, FleetActivityChart, …) is drop-in compatible.
=======
 * Shared widget shell: a frosted-glass titled card with an optional live badge,
 * header action slot, and consistent loading (skeleton) + empty states.
 *
 * v5 (Glassmorphism): every dashboard card is a frosted-glass surface —
 * semi-transparent with a soft blur, a gradient highlight edge, a layered
 * shadow, and a sheen sweep on hover. The icon sits in a tinted glass badge.
 * Properties (titleKey/icon/live/action/loading/empty) are unchanged so all 8
 * dashboard widgets + ReportChart inherit the new look without edits.
>>>>>>> 5bdd11003cc6ed2a06307b253ebd40c49da3ea6e
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
  className = '',
}: WidgetCardProps) {
  const { t } = useTranslation();
  const { mode } = useThemeContext();
  const g = mode === 'dark' ? glass.dark : glass.light;

  return (
<<<<<<< HEAD
    <div
      className={`flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/5 dark:bg-graydark-200 ${className}`}
      style={sx as CSSProperties | undefined}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <span className="shrink-0 text-gray-500 dark:text-graydark-600">
              <Icon size={18} />
            </span>
          )}
          <h3 className="truncate text-base font-semibold text-gray-800 dark:text-white">
            {t(titleKey)}
          </h3>
          {live && <LiveBadge />}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
=======
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
>>>>>>> 5bdd11003cc6ed2a06307b253ebd40c49da3ea6e

      {/* Body */}
      <div className="flex flex-1 flex-col">
        {loading ? (
<<<<<<< HEAD
          <div className="min-h-[120px] flex-1 animate-pulse rounded-lg bg-gray-100 dark:bg-white/5" />
=======
          <Skeleton
            variant="rounded"
            sx={{ flex: 1, minHeight: 120, borderRadius: glass.radiusSm }}
          />
>>>>>>> 5bdd11003cc6ed2a06307b253ebd40c49da3ea6e
        ) : empty && emptyKey ? (
          <p className="py-2 text-sm text-gray-500 dark:text-graydark-600">{t(emptyKey)}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

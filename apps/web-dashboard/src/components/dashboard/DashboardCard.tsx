import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/common/ErrorState';
import { Card, EmptyState, Skeleton } from '@/components/tailwind-ui';
import { LiveBadge } from './LiveBadge';

/** Optional colored accent for the card's top edge (section color coding). */
export type CardAccent = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'teal' | 'purple';

const ACCENTS: Record<CardAccent, string> = {
  brand: 'from-brand-500/70',
  success: 'from-success-500/70',
  warning: 'from-warning-500/70',
  danger: 'from-danger-500/70',
  info: 'from-info-500/70',
  teal: 'from-teal-500/70',
  purple: 'from-purple-500/70',
};

/** Tinted icon chip classes per accent. */
const ICON_CHIPS: Record<CardAccent, string> = {
  brand: 'bg-brand-500/10 text-brand-600 dark:text-brand-300',
  success: 'bg-success-500/10 text-success-600 dark:text-success-400',
  warning: 'bg-warning-500/12 text-warning-600 dark:text-warning-400',
  danger: 'bg-danger-500/10 text-danger-600 dark:text-danger-400',
  info: 'bg-info-500/10 text-info-600 dark:text-info-400',
  teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-300',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-300',
};

export interface DashboardCardProps {
  /** Card title (plain node) — or `titleKey` for an i18n key. */
  title?: ReactNode;
  titleKey?: string;
  icon?: LucideIcon;
  /** Colored top-edge accent + tinted icon chip. */
  accent?: CardAccent;
  /** Right-aligned header slot (links, buttons). */
  action?: ReactNode;
  live?: boolean;
  /** Show the loading skeleton instead of children. */
  loading?: boolean;
  /** Show the empty state instead of children. */
  empty?: boolean;
  /** i18n key rendered by the empty state. */
  emptyKey?: string;
  /** Query error — renders ErrorState with retry instead of children. */
  error?: unknown;
  onRetry?: () => void;
  /** Remove default padding (children manage spacing, e.g. charts/maps). */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * DashboardCard — the widget chrome for dashboard panels.
 *
 * One surface with the standard header (tinted icon chip + title + live badge +
 * action), an optional gradient top-edge accent, and the three honest body
 * states: loading skeleton, error with retry, empty placeholder — data panels
 * never render fabricated content (§22).
 */
export function DashboardCard({
  title,
  titleKey,
  icon: Icon,
  accent,
  action,
  live = false,
  loading = false,
  empty = false,
  emptyKey,
  error,
  onRetry,
  flush = false,
  className = '',
  children,
}: DashboardCardProps) {
  const { t } = useTranslation();
  const heading = title ?? (titleKey ? t(titleKey) : null);

  let body: ReactNode;
  if (error !== undefined && error !== null) {
    body = <ErrorState error={error} onRetry={onRetry} />;
  } else if (loading) {
    body = (
      <div className="flex flex-col gap-2.5" aria-hidden>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    );
  } else if (empty) {
    body = <EmptyState title={t(emptyKey ?? 'common.noData')} />;
  } else {
    body = children;
  }

  return (
    <Card
      flush
      className={`group relative h-full transition-shadow duration-300 hover:shadow-md ${className}`}
    >
      {/* Colored top-edge accent hairline (fades to transparent). */}
      {accent && (
        <span
          aria-hidden
          className={`absolute inset-x-0 top-0 h-[2.5px] rounded-t-2xl bg-gradient-to-r to-transparent ${ACCENTS[accent]}`}
        />
      )}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span
              aria-hidden
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4 ${
                accent
                  ? ICON_CHIPS[accent]
                  : 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-graydark-600'
              }`}
            >
              <Icon />
            </span>
          )}
          <h3 className="truncate text-sm font-bold text-gray-800 dark:text-white">{heading}</h3>
          {live && <LiveBadge />}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={`min-h-0 flex-1 ${flush ? '' : 'px-4 pb-4 sm:px-5 sm:pb-5'}`}>{body}</div>
    </Card>
  );
}

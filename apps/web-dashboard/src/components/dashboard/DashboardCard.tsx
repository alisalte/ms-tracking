import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/common/ErrorState';
import { Card, EmptyState, Skeleton } from '@/components/tailwind-ui';
import { LiveBadge } from './LiveBadge';

export interface DashboardCardProps {
  /** Card title (plain node) — or `titleKey` for an i18n key. */
  title?: ReactNode;
  titleKey?: string;
  icon?: LucideIcon;
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
 * DashboardCard — the TailAdmin widget chrome for dashboard panels (Phase 4).
 *
 * One surface with the standard header (icon + title + live badge + action)
 * and the three honest body states: loading skeleton, error with retry, empty
 * placeholder — data panels never render fabricated content (§22).
 */
export function DashboardCard({
  title,
  titleKey,
  icon: Icon,
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
    <Card flush className={`h-full ${className}`}>
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <Icon size={17} aria-hidden className="shrink-0 text-gray-400 dark:text-graydark-600" />
          )}
          <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-white">
            {heading}
          </h3>
          {live && <LiveBadge />}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={`min-h-0 flex-1 ${flush ? '' : 'px-5 pb-5'}`}>{body}</div>
    </Card>
  );
}

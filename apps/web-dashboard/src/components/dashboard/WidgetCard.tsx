import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
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
  /** Optional extra style for the card root (legacy MUI callers pass `sx`). */
  sx?: object;
  className?: string;
}

/**
 * Shared widget shell: a titled TailAdmin card with an optional live badge,
 * header action slot, and consistent loading (skeleton) + empty states.
 *
 * Tailwind version. Per UI_UX_Design.md §0.6, initial load uses skeletons (not
 * spinners) and the live badge is the pulsing freshness dot reserved for
 * real-time panels. Props mirror the legacy MUI WidgetCard so every consumer
 * (ActiveAlertsPanel, FleetActivityChart, …) is drop-in compatible.
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
  return (
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

      {/* Body */}
      <div className="flex flex-1 flex-col">
        {loading ? (
          <div className="min-h-[120px] flex-1 animate-pulse rounded-lg bg-gray-100 dark:bg-white/5" />
        ) : empty && emptyKey ? (
          <p className="py-2 text-sm text-gray-500 dark:text-graydark-600">{t(emptyKey)}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

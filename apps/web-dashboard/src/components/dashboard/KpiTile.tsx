import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/tailwind-ui';

/** Semantic tile tones → Tailwind badge classes. */
const TONES = {
  brand:
    'bg-brand-50 text-brand-600 border-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:border-brand-500/20',
  success:
    'bg-success-50 text-success-600 border-success-100 dark:bg-success-500/10 dark:text-success-400 dark:border-success-500/20',
  warning:
    'bg-warning-50 text-warning-600 border-warning-100 dark:bg-warning-500/10 dark:text-warning-400 dark:border-warning-500/20',
  danger:
    'bg-danger-50 text-danger-600 border-danger-100 dark:bg-danger-500/10 dark:text-danger-400 dark:border-danger-500/20',
  info: 'bg-info-50 text-info-600 border-info-100 dark:bg-info-500/10 dark:text-info-400 dark:border-info-500/20',
  gray: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-white/5 dark:text-graydark-700 dark:border-white/10',
} as const;

export interface KpiTileProps {
  /** i18n key for the metric label. */
  labelKey: string;
  /** Headline value. */
  value: number | null | undefined;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  loading?: boolean;
  /** Click-through to the owning page (optional). */
  onClick?: () => void;
}

/**
 * KpiTile — the TailAdmin stat tile (Phase 4).
 *
 * REAL counts only: value comes from a live query (fleet summary, device
 * statuses, alarm feed) — never a fabricated delta or sparkline.
 */
export function KpiTile({
  labelKey,
  value,
  icon: Icon,
  tone = 'brand',
  loading,
  onClick,
}: KpiTileProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-center gap-3.5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow dark:border-white/5 dark:bg-graydark-300 ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      }`}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span
        aria-hidden
        className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-5 ${TONES[tone]}`}
      >
        <Icon />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-graydark-600">
          {t(labelKey)}
        </p>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-14" />
        ) : (
          <p className="text-[1.75rem] leading-tight font-bold tabular-nums text-gray-900 dark:text-white">
            {(value ?? 0).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

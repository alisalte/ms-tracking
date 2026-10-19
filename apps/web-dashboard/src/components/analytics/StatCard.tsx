import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, Skeleton } from '@/components/tailwind-ui';

const TONES = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
  success: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400',
  warning: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400',
  danger: 'bg-danger-50 text-danger-600 dark:bg-danger-500/15 dark:text-danger-400',
  info: 'bg-info-50 text-info-600 dark:bg-info-500/15 dark:text-info-300',
} as const;

/**
 * StatCard — compact metric tile for the analytics page. Unlike the dashboard
 * `KpiTile` it takes an already-formatted value + a one-line plain-language
 * hint, so units (km², h, %) read naturally in both locales.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = 'brand',
  loading,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Unit shown smaller after the value, so long units never truncate it. */
  unit?: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  loading?: boolean;
}) {
  return (
    <Card className="flex items-start gap-3 !p-3.5 sm:!p-4">
      <span
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}
      >
        <Icon size={19} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-gray-500 dark:text-graydark-600">{label}</p>
        {loading ? (
          <Skeleton className="mt-1.5 h-6 w-20" />
        ) : (
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-lg font-bold tabular-nums text-gray-900 sm:text-xl dark:text-white">
            <span>{value}</span>
            {unit && (
              <span className="text-xs font-semibold text-gray-500 dark:text-graydark-600">
                {unit}
              </span>
            )}
          </p>
        )}
        {hint && !loading && (
          <p className="mt-0.5 line-clamp-2 text-[0.7rem] leading-4 text-gray-500 dark:text-graydark-600">
            {hint}
          </p>
        )}
      </div>
    </Card>
  );
}

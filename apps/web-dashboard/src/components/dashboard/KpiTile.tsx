import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, Skeleton } from '@/components/tailwind-ui';
import { formatNumber } from '@/lib/format-number';

/**
 * KpiTile — compact metric card for the live dashboard row.
 *
 * REAL counts only: `value` comes from a live query — never a fabricated delta
 * or sparkline (§22). The optional `footer` chip carries a REAL secondary fact
 * supplied by the caller.
 */

const TONES = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
  success: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400',
  warning: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400',
  danger: 'bg-danger-50 text-danger-600 dark:bg-danger-500/15 dark:text-danger-400',
  info: 'bg-info-50 text-info-600 dark:bg-info-500/15 dark:text-info-300',
  teal: 'bg-info-50 text-info-600 dark:bg-info-500/15 dark:text-info-300',
  purple: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
  gray: 'bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-graydark-600',
} as const;

type ToneKey = keyof typeof TONES;

export interface KpiTileProps {
  /** i18n key for the metric label. */
  labelKey: string;
  /** Headline value. */
  value: number | null | undefined;
  icon: LucideIcon;
  tone?: ToneKey;
  loading?: boolean;
  /** Unit suffix rendered after the value (e.g. "%" for utilization). */
  suffix?: string;
  /** REAL secondary fact rendered as a footer chip (never fabricated). */
  footer?: ReactNode;
  /** Click-through to the owning page (optional). */
  onClick?: () => void;
}

export function KpiTile({
  labelKey,
  value,
  icon: Icon,
  tone = 'brand',
  loading,
  suffix,
  footer,
  onClick,
}: KpiTileProps) {
  const { t, i18n } = useTranslation();
  const chip = TONES[tone];

  return (
    <Card
      flush
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e: React.KeyboardEvent<HTMLElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`fv-kpi group relative flex min-h-[104px] flex-col p-4 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
        onClick ? 'cursor-pointer hover:border-brand-300 dark:hover:border-brand-500/40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-gray-500 dark:text-graydark-600">
            {t(labelKey)}
          </p>
          <div className="mt-1.5 min-w-0">
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="flex items-baseline gap-1 text-[1.65rem] leading-none font-bold tabular-nums tracking-tight text-gray-800 dark:text-white">
                {value === null || value === undefined ? (
                  '—'
                ) : (
                  <>
                    {formatNumber(value, i18n.language)}
                    {suffix && (
                      <span className="text-sm font-semibold text-gray-400 dark:text-graydark-500">
                        {suffix}
                      </span>
                    )}
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        <span
          aria-hidden
          className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5 ${chip}`}
        >
          <Icon strokeWidth={1.75} />
        </span>
      </div>
      <div className="mt-auto flex min-h-[18px] items-center pt-2.5">{footer}</div>
    </Card>
  );
}

/** Small tinted chip used inside a KpiTile footer. */
export function KpiChip({
  children,
  tone = 'gray',
}: {
  children: ReactNode;
  tone?: 'gray' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const cls = {
    gray: 'bg-gray-100 text-gray-600 dark:bg-white/8 dark:text-graydark-600',
    success: 'bg-success-50 text-success-600 dark:bg-success-500/12 dark:text-success-400',
    warning: 'bg-warning-50 text-warning-600 dark:bg-warning-500/12 dark:text-warning-400',
    danger: 'bg-danger-50 text-danger-600 dark:bg-danger-500/12 dark:text-danger-400',
    info: 'bg-info-50 text-info-600 dark:bg-info-500/12 dark:text-info-400',
  }[tone];
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px] leading-4 font-medium tabular-nums ${cls}`}
    >
      {children}
    </span>
  );
}

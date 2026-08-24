import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, Skeleton } from '@/components/tailwind-ui';

/**
 * KpiTile — Phase 5 "operations console" stat tile.
 *
 * REAL counts only: `value` comes from a live query — never a fabricated delta
 * or sparkline (§22). The optional `footer` chip carries a REAL secondary fact
 * (e.g. "66% از آنلاین‌ها" or "۳ بحرانی") supplied by the caller.
 *
 * Visual language: soft tinted icon chip with a matching corner glow, a hairline
 * accent bar on the trailing edge, and a hover lift — calm colors, no loud
 * gradients that fight the numbers.
 */

/** Semantic tile tones — icon chip classes, accent bar, and glow tint. */
const TONES = {
  brand: {
    chip: 'bg-brand-500/12 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
    bar: 'bg-brand-500',
  },
  success: {
    chip: 'bg-success-500/12 text-success-600 dark:bg-success-500/15 dark:text-success-400',
    bar: 'bg-success-500',
  },
  warning: {
    chip: 'bg-warning-500/14 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400',
    bar: 'bg-warning-500',
  },
  danger: {
    chip: 'bg-danger-500/12 text-danger-600 dark:bg-danger-500/15 dark:text-danger-400',
    bar: 'bg-danger-500',
  },
  info: {
    chip: 'bg-info-500/12 text-info-600 dark:bg-info-500/15 dark:text-info-400',
    bar: 'bg-info-500',
  },
  teal: {
    chip: 'bg-teal-500/12 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300',
    bar: 'bg-teal-500',
  },
  purple: {
    chip: 'bg-purple-500/12 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300',
    bar: 'bg-purple-500',
  },
  gray: 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-graydark-700',
} as const;

type ToneKey = keyof typeof TONES;

function toneClasses(tone: ToneKey) {
  const t = TONES[tone];
  if (typeof t === 'string') return { chip: t, bar: 'bg-gray-300 dark:bg-white/10' };
  return t;
}

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
  const { t } = useTranslation();
  const { chip, bar } = toneClasses(tone);

  return (
    <Card
      interactive={Boolean(onClick)}
      flush
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e: React.KeyboardEvent<HTMLElement>) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`group relative flex min-h-[104px] flex-col overflow-hidden p-4 transition-all duration-300 ${
        onClick ? 'cursor-pointer' : ''
      } hover:shadow-lg hover:shadow-gray-900/6 dark:hover:shadow-black/30 hover:-translate-y-0.5`}
    >
      {/* Material Dashboard signature: a short colored accent line along the
          card's bottom edge, tinted by the metric's semantic tone. */}
      <span
        aria-hidden
        className={`absolute bottom-0 start-0 h-[3px] w-[42%] rounded-t-full ${bar} opacity-90`}
      />
      {/* Row 1: label (full width) + circular tone icon at the far end. */}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate pt-1 text-[0.68rem] leading-snug font-bold tracking-[0.03em] text-gray-500 dark:text-graydark-600">
          {t(labelKey)}
        </p>
        <span
          aria-hidden
          className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full shadow-sm [&_svg]:size-[19px] ${chip}`}
        >
          <Icon strokeWidth={2.1} />
        </span>
      </div>
      {/* Row 2: the value — the DOMINANT element of the card. */}
      <div className="mt-1 min-w-0">
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="flex items-baseline gap-1 text-[1.7rem] leading-none font-black tabular-nums tracking-tight text-gray-950 dark:text-white">
            {/* null post-load = genuinely no data — never shown as a fabricated 0. */}
            {value === null || value === undefined ? (
              '—'
            ) : (
              <>
                {value.toLocaleString()}
                {suffix && (
                  <span className="text-xs font-bold text-gray-400 dark:text-graydark-500">
                    {suffix}
                  </span>
                )}
              </>
            )}
          </p>
        )}
      </div>
      {/* Row 3: footer chip — min-height keeps every tile the same height. */}
      <div className="mt-auto flex min-h-[20px] items-center pt-1.5">{footer}</div>
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
    gray: 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-graydark-600',
    success: 'bg-success-500/10 text-success-600 dark:text-success-400',
    warning: 'bg-warning-500/12 text-warning-600 dark:text-warning-400',
    danger: 'bg-danger-500/10 text-danger-600 dark:text-danger-400',
    info: 'bg-info-500/10 text-info-600 dark:text-info-400',
  }[tone];
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-px text-[0.64rem] leading-4 font-semibold tabular-nums ${cls}`}
    >
      {children}
    </span>
  );
}

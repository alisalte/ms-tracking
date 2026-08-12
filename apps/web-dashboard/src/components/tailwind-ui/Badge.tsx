import type { ReactNode } from 'react';

/**
 * Badge — TailAdmin pill label (Tailwind).
 *
 * Soft tonal variants for status/meta tags. Heights kept tight (20px) for the
 * dense enterprise aesthetic.
 */
type Color =
  | 'brand'
  | 'gray'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'purple'
  | 'pink'
  | 'teal';

export interface BadgeProps {
  children: ReactNode;
  color?: Color;
  className?: string;
  /** Render a leading dot. */
  dot?: boolean;
  title?: string;
}

const COLORS: Record<Color, string> = {
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  gray: 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-graydark-700',
  success: 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400',
  warning: 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400',
  danger: 'bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-400',
  info: 'bg-info-50 text-info-700 dark:bg-info-500/15 dark:text-info-400',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
};

const DOTS: Record<Color, string> = {
  brand: 'bg-brand-500',
  gray: 'bg-gray-400',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500',
};

export function Badge({
  children,
  color = 'gray',
  className = '',
  dot = false,
  title,
}: BadgeProps) {
  const cls = [
    'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
    COLORS[color],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} title={title}>
      {dot && <span className={`size-1.5 rounded-full ${DOTS[color]}`} />}
      {children}
    </span>
  );
}

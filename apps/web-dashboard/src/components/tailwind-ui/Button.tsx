import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Button — TailAdmin action primitive (Tailwind).
 *
 * Variants mirror TailAdmin's button set (primary brand, secondary outline,
 * ghost, soft). Sizes are dense to match the enterprise ops aesthetic. All
 * variants are RTL-safe (logical padding) and dark-mode-aware.
 */
type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm shadow-brand-500/20',
  secondary:
    'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 ' +
    'dark:bg-graydark-300 dark:text-graydark-800 dark:border-white/10 dark:hover:bg-graydark-400',
  outline:
    'border border-brand-500 text-brand-600 hover:bg-brand-50 ' +
    'dark:border-brand-400 dark:text-brand-300 dark:hover:bg-brand-500/10',
  ghost:
    'text-gray-600 hover:bg-gray-100 hover:text-gray-900 ' +
    'dark:text-graydark-700 dark:hover:bg-white/5 dark:hover:text-white',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700',
  success: 'bg-success-600 text-white hover:bg-success-700 active:bg-success-700',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  fullWidth = false,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    'inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
}

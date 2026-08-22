import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Button — TailAdmin action primitive (Tailwind), Phase 2.6 fidelity pass.
 *
 * Mirrors the official TailAdmin React Button: comfortable 42px default
 * height (py-2.5), ring-based outline styling, per-variant disabled shades,
 * and the signature small theme shadow on filled variants. All variants are
 * RTL-safe (logical padding) and dark-mode-aware.
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
    'bg-brand-500 text-white shadow-sm shadow-brand-500/25 hover:bg-brand-600 active:bg-brand-700 ' +
    'disabled:bg-brand-400 disabled:text-white/70 disabled:shadow-none',
  secondary:
    'bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 hover:text-gray-900 ' +
    'disabled:bg-gray-100 disabled:text-gray-400 ' +
    'dark:bg-white/5 dark:text-graydark-700 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-white',
  outline:
    'text-brand-600 ring-1 ring-inset ring-brand-500 hover:bg-brand-50 hover:text-brand-700 ' +
    'disabled:text-brand-300 disabled:ring-brand-200 ' +
    'dark:text-brand-300 dark:ring-brand-400/60 dark:hover:bg-brand-500/10 dark:disabled:ring-brand-400/30',
  ghost:
    'text-gray-600 hover:bg-gray-100 hover:text-gray-900 ' +
    'dark:text-graydark-700 dark:hover:bg-white/5 dark:hover:text-white',
  danger:
    'bg-danger-600 text-white shadow-sm shadow-danger-600/25 hover:bg-danger-700 active:bg-danger-800 ' +
    'disabled:bg-danger-400 disabled:shadow-none',
  success:
    'bg-success-600 text-white shadow-sm shadow-success-600/25 hover:bg-success-700 active:bg-success-800 ' +
    'disabled:bg-success-400 disabled:shadow-none',
};

/** TailAdmin size scale: sm 36px · md 42px · lg 48px. */
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-xs gap-1.5',
  md: 'h-10.5 px-4.5 text-sm gap-2',
  lg: 'h-12 px-5.5 text-sm gap-2',
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
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-graydark-200',
    'disabled:cursor-not-allowed',
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

import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * IconButton — square icon-only button (Tailwind).
 *
 * Used in the topbar and widget headers. Includes an accessible label
 * (required — `aria-label`), focus ring, and dark-mode variants.
 */
type Variant = 'ghost' | 'solid' | 'outline';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
}

const VARIANTS: Record<Variant, string> = {
  ghost:
    'text-gray-500 hover:bg-gray-100 hover:text-gray-700 ' +
    'dark:text-graydark-600 dark:hover:bg-white/5 dark:hover:text-white',
  solid:
    'bg-brand-500 text-white shadow-sm shadow-brand-500/25 hover:bg-brand-600 active:bg-brand-700',
  outline:
    'bg-white text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 hover:text-gray-900 ' +
    'dark:bg-white/5 dark:text-graydark-700 dark:ring-white/10 dark:hover:bg-white/10',
};

/** TailAdmin scale: sm 32px · md 38px · lg 44px. */
const SIZES = {
  sm: 'size-8',
  md: 'size-9.5',
  lg: 'size-11',
};

export function IconButton({
  children,
  variant = 'ghost',
  size = 'md',
  className = '',
  ...rest
}: IconButtonProps) {
  const cls = [
    'inline-flex items-center justify-center rounded-lg transition-colors duration-150',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

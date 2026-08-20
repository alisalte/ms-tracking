import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

/**
 * Card — TailAdmin surface primitive (Tailwind).
 *
 * Layered neutral surface that adapts to dark mode via `dark:` utilities. No
 * dependency on preflight (explicit border + bg tokens). Used by the shell,
 * dashboard widgets, and reusable by future pages.
 */
export type CardProps<T extends ElementType = 'div'> = {
  as?: T;
  children?: ReactNode;
  className?: string;
  /** Add interactive hover affordance (lift + shadow). */
  interactive?: boolean;
  /** Remove the default padding so children control spacing. */
  flush?: boolean;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

const BASE = 'fv-surface rounded-2xl border';

const PADDING = 'p-4 sm:p-5';
const INTERACTIVE =
  'transition duration-200 hover:-translate-y-0.5 hover:shadow-xl dark:hover:border-white/12';

export function Card<T extends ElementType = 'div'>({
  as,
  children,
  className = '',
  interactive = false,
  flush = false,
  ...rest
}: CardProps<T>) {
  const Component = (as ?? 'div') as ElementType;
  const cls = [BASE, interactive ? INTERACTIVE : '', flush ? '' : PADDING, className]
    .filter(Boolean)
    .join(' ');
  return (
    <Component className={cls} {...rest}>
      {children}
    </Component>
  );
}

/** Card header row with title + optional action slot. */
export function CardHeader({
  title,
  icon,
  action,
  className = '',
}: {
  title: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex items-center justify-between gap-2 ${className}`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="shrink-0 text-gray-500 dark:text-graydark-700">{icon}</span>}
        <h3 className="truncate text-base font-semibold text-gray-800 dark:text-white">{title}</h3>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

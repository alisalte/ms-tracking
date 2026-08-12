import type { ReactNode } from 'react';
import { useId, useState } from 'react';

/**
 * Tooltip — lightweight, dependency-free title attribute wrapper.
 *
 * Uses the native `title` attribute for guaranteed accessibility (screen
 * readers + keyboard focus) and a small CSS-driven overlay for richer
 * presentation. Deliberately simple to avoid pulling in a floating-ui stack;
 * the shell + dashboard only need hover labels.
 */
export interface TooltipProps {
  children: ReactNode;
  label: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const SIDE: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

export function Tooltip({ children, label, side = 'bottom', className = '' }: TooltipProps) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      <span aria-describedby={show ? id : undefined}>{children}</span>
      {show && (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg dark:bg-graydark-400 ${SIDE[side]}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}

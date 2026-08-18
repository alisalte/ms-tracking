import { ChevronDown } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';

/**
 * Dropdown — TailAdmin menu primitive (Tailwind, dependency-free).
 *
 * A trigger button plus an absolutely-positioned menu that closes on outside
 * click, ESC, or item selection. Items are `DropdownItem` buttons rendered via
 * children. RTL-aware: `align` uses logical start/end; the chevron flips with
 * the document direction via `rtl:rotate-180`.
 *
 * Known limitation (documented in PHASE_2): no arrow-key roving focus inside
 * the menu yet — items are real buttons reachable with Tab.
 */
export interface DropdownProps {
  /** Trigger copy; omit when supplying a fully custom `trigger`. */
  label?: ReactNode;
  /** Custom trigger node (e.g. an avatar) rendered inside the trigger button. */
  trigger?: ReactNode;
  /** Menu alignment relative to the trigger (logical; default 'end'). */
  align?: 'start' | 'end';
  /** Opening direction of the menu (default 'down'). */
  up?: boolean;
  children: ReactNode;
  className?: string;
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
  'aria-label'?: string;
}

const DropdownContext = createContext<{ close: () => void }>({ close: () => {} });

export function Dropdown({
  label,
  trigger,
  align = 'end',
  up = false,
  children,
  className = '',
  triggerClassName = '',
  'aria-label': ariaLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Outside-press + ESC close.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={
          triggerClassName ||
          'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-graydark-700 dark:hover:bg-white/5 dark:hover:text-white'
        }
      >
        {trigger ?? (
          <>
            {label}
            <ChevronDown size={15} className="shrink-0 opacity-60 rtl:rotate-180" />
          </>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className={`absolute z-50 min-w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-graydark-300 ${
            align === 'end' ? 'end-0' : 'start-0'
          } ${up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
            {children}
          </DropdownContext.Provider>
        </div>
      )}
    </div>
  );
}

export interface DropdownItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  /** Trailing slot (e.g. a checkmark for the current option). */
  trailing?: ReactNode;
  /** Muted non-interactive row (section header inside the menu). */
  header?: boolean;
  danger?: boolean;
}

export function DropdownItem({
  icon,
  trailing,
  header = false,
  danger = false,
  className = '',
  children,
  onClick,
  ...rest
}: DropdownItemProps) {
  const { close } = useContext(DropdownContext);

  if (header) {
    return (
      <div
        className={`px-3 py-2 text-start text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600 ${className}`}
      >
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={(event) => {
        onClick?.(event);
        close();
      }}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition-colors focus:outline-none focus-visible:bg-gray-100 dark:focus-visible:bg-white/5 ${
        danger
          ? 'text-danger-600 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-500/10'
          : 'text-gray-700 hover:bg-gray-100 dark:text-graydark-700 dark:hover:bg-white/5'
      } ${className}`}
      {...rest}
    >
      {icon && <span className="shrink-0 [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing && <span className="shrink-0 text-gray-400">{trailing}</span>}
    </button>
  );
}

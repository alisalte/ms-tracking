import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Drawer — TailAdmin slide-over panel (Tailwind).
 *
 * The shared entity-detail/form surface: slides in from the inline-end edge
 * (`end-0` — automatically flips with RTL), backdrop + ESC to close, body
 * scroll locked while open. Header carries the title + close button; content
 * scrolls; an optional footer row pins actions (save/cancel).
 *
 * Accessibility mirrors Modal: `role="dialog"` + `aria-modal`, labelled by the
 * title. Known limitation (shared with Modal): no full focus trap yet.
 */
export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  /** Action row (buttons) pinned under the scrollable body. */
  footer?: ReactNode;
  /** Sub-heading under the title (e.g. entity id / updated-at). */
  subtitle?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Disable closing on backdrop click (e.g. dirty forms). */
  closeOnBackdrop?: boolean;
  className?: string;
}

const SIZES: Record<NonNullable<DrawerProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  className = '',
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      {/* Backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px] transition-opacity"
        onMouseDown={closeOnBackdrop ? onClose : undefined}
      />
      {/* Panel — slides from the inline-end edge (flips with dir=rtl) */}
      <div
        ref={panelRef}
        // biome-ignore lint/a11y/useSemanticElements: no native non-modal slide-over element; ARIA dialog + portal is the standard pattern
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        tabIndex={-1}
        className={`fv-rise relative flex h-full w-full flex-col border-s border-gray-200 bg-white shadow-2xl outline-none dark:border-white/10 dark:bg-graydark-300 ${SIZES[size]} ${className}`}
      >
        {title !== undefined && (
          <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-white/10">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="truncate text-base font-semibold text-gray-900 dark:text-white"
              >
                {title}
              </h2>
              {subtitle && (
                <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-graydark-600">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-me-1 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5 dark:hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="fv-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-3.5 dark:border-white/10">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Modal — TailAdmin dialog primitive (Tailwind, dependency-free).
 *
 * Renders into a `document.body` portal with the TailAdmin surface style.
 * Accessibility: `role="dialog"` + `aria-modal`, labelled by the title, ESC to
 * close, backdrop click to close (configurable), initial focus moved onto the
 * panel, and body scroll locked while open.
 *
 * Known limitation (documented in PHASE_2): no full focus trap yet — focus can
 * still tab out of the dialog. Phase 3 ports pages onto this primitive and can
 * add a trap if audits require it.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  /** Action row (buttons) pinned under the body. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Disable closing on backdrop click (defaults to enabled). */
  closeOnBackdrop?: boolean;
  className?: string;
}

const SIZES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  className = '',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // ESC closes; body scroll locks while open (restored on unmount/close).
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gray-900/60 backdrop-blur-[2px]"
        onMouseDown={closeOnBackdrop ? onClose : undefined}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        // biome-ignore lint/a11y/useSemanticElements: native <dialog> has no controlled-open React API; ARIA dialog + portal is the standard pattern
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        tabIndex={-1}
        className={`relative flex w-full flex-col rounded-xl border border-gray-200 bg-white shadow-xl outline-none dark:border-white/10 dark:bg-graydark-300 ${
          size === 'xl' ? 'max-h-[92vh]' : 'max-h-[85vh]'
        } ${SIZES[size]} ${className}`}
      >
        {title !== undefined && (
          <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-white/10">
            <h2
              id={titleId}
              className="text-base font-semibold text-gray-900 outline-none dark:text-white"
            >
              {title}
            </h2>
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

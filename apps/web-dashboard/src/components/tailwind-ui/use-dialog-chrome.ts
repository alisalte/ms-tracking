/**
 * Shared open-chrome for Modal and Drawer: ESC to close, body scroll lock,
 * and initial focus on the panel.
 *
 * `onClose` is read from a ref so callers can pass an inline
 * `() => setOpen(false)` without re-running the effect (which would steal
 * focus from inputs on every keystroke).
 */
import { type RefObject, useEffect, useRef } from 'react';

export function useDialogChrome(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, panelRef]);
}

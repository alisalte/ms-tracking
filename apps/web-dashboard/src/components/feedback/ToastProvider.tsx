import { AlertCircle, CheckCircle2, Info, X, TriangleAlert } from 'lucide-react';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';

/** Toast severity. */
type ToastSeverity = 'success' | 'error' | 'info' | 'warning';

/** A toast notification call surface. */
export interface ToastApi {
  /** Show a success toast (messageKey is an i18n key OR a raw string). */
  success: (messageKey: string) => void;
  /** Show an error toast — accepts an i18n key OR an Error/unknown (message extracted). */
  error: (messageKeyOrError: string | unknown) => void;
  /** Show an info toast. */
  info: (messageKey: string) => void;
  /** Show a toast with an explicit severity + raw (already-translated) message. */
  show: (severity: ToastSeverity, rawMessage: string) => void;
}

const ToastContext = createContext<ToastApi>({
  success: () => {},
  error: () => {},
  info: () => {},
  show: () => {},
});

interface ToastRecord {
  id: number;
  severity: ToastSeverity;
  message: string;
}

const AUTO_DISMISS_MS = 5000;
/** Cap the stack so a burst of errors cannot wallpaper the screen. */
const MAX_VISIBLE = 4;

/**
 * Hook to fire toast notifications from anywhere under the provider.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

interface ToastProviderProps {
  children: ReactNode;
}

const SEVERITY_STYLE: Record<ToastSeverity, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: {
    icon: CheckCircle2,
    ring: 'border-success-500/40',
    iconColor: 'text-success-600 dark:text-success-400',
  },
  error: {
    icon: AlertCircle,
    ring: 'border-danger-500/40',
    iconColor: 'text-danger-600 dark:text-danger-400',
  },
  warning: {
    icon: TriangleAlert,
    ring: 'border-warning-500/40',
    iconColor: 'text-warning-600 dark:text-warning-400',
  },
  info: {
    icon: Info,
    ring: 'border-info-500/40',
    iconColor: 'text-info-600 dark:text-info-400',
  },
};

/**
 * ToastProvider — app-wide stacked toast notifications (Tailwind, zero deps).
 *
 * Replaces the single-slot MUI Snackbar: toasts queue and stack (newest on the
 * bottom), each auto-dismisses after 5s, and a manual close button is always
 * available. `useToast()` keeps its exact API — call sites are unchanged.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (severity: ToastSeverity, rawMessage: string) => {
      const id = ++nextId.current;
      setToasts((current) => [...current, { id, severity, message: rawMessage }].slice(-MAX_VISIBLE));
    },
    [],
  );

  // Resolve a key: translate if it has a translation, otherwise use as-is.
  const resolve = useCallback(
    (key: string): string => {
      const translated = t(key);
      // i18next returns the key itself when no translation exists.
      return translated === key ? key : translated;
    },
    [t],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (key) => show('success', resolve(key)),
      info: (key) => show('info', resolve(key)),
      error: (keyOrError) => {
        if (typeof keyOrError === 'string') {
          show('error', resolve(keyOrError));
          return;
        }
        // Error/unknown → extract message, fall back to a generic i18n key.
        const msg = getApiErrorMessage(keyOrError);
        show('error', msg || resolve('errors.generic'));
      },
    }),
    [show, resolve],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Stack — anchored bottom inline-end (flips with RTL) */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 end-4 z-[200] flex w-[min(92vw,420px)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const style = SEVERITY_STYLE[toast.severity];
  const Icon = style.icon;

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className={`fv-rise pointer-events-auto flex items-start gap-2.5 rounded-xl border ${style.ring} bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:bg-graydark-300/95`}
    >
      <Icon size={17} aria-hidden className={`mt-0.5 shrink-0 ${style.iconColor}`} />
      <p className="min-w-0 flex-1 text-sm text-gray-800 dark:text-graydark-800">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-me-1 -mt-0.5 shrink-0 cursor-pointer rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5 dark:hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  );
}

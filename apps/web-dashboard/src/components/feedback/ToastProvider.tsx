import { Alert, AlertColor, Snackbar, Typography } from '@mui/material';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
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

interface ToastState {
  open: boolean;
  severity: ToastSeverity;
  message: string;
}

/**
 * Hook to fire toast notifications from anywhere under the provider.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

interface ToastProviderProps {
  children: ReactNode;
}

/**
 * ToastProvider — app-wide toast/snackbar notifications (zero dependencies).
 *
 * Renders a single MUI `<Snackbar>` driven by a context. `useToast()` exposes
 * `success/error/info/show`. The error helper accepts either an i18n key or a
 * thrown value (Error/ApiClientError) and extracts a readable message via
 * `getApiErrorMessage`.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<ToastState>({
    open: false,
    severity: 'info',
    message: '',
  });

  const show = useCallback((severity: ToastSeverity, rawMessage: string) => {
    setState({ open: true, severity, message: rawMessage });
  }, []);

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

  const colorMap: Record<ToastSeverity, AlertColor> = {
    success: 'success',
    error: 'error',
    info: 'info',
    warning: 'warning',
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        open={state.open}
        autoHideDuration={5000}
        onClose={() => setState((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={colorMap[state.severity]}
          variant="filled"
          onClose={() => setState((s) => ({ ...s, open: false }))}
          sx={{ alignItems: 'center', maxWidth: 480 }}
        >
          <Typography variant="body2" component="span">
            {state.message}
          </Typography>
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

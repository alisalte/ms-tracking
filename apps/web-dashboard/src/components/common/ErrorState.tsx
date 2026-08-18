/**
 * ErrorState — reusable error display for failed API queries.
 *
 * Renders a centered icon + message + retry button. Used by every page's
 * `isError` branch so a failed fetch never renders a blank screen. Classifies
 * the typed API error into: 401 (session expired), 403 (forbidden), network
 * failure, or generic — Phase 3 error states.
 */
import { AlertTriangle, Lock, ShieldOff, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ApiClientError } from '@/api/errors';
import { Button } from '@/components/tailwind-ui';

interface ErrorStateProps {
  /** The error from React Query (isError → error). */
  error: unknown;
  /** Retry handler (e.g. React Query's refetch). */
  onRetry?: () => void;
}

/** Map an ApiClientError subclass to the right icon + message key. */
function classifyError(error: unknown): { icon: LucideIcon; titleKey: string; descKey: string } {
  const e = error as Partial<ApiClientError>;
  const status = e?.status;

  if (status === 401) {
    return { icon: Lock, titleKey: 'errors.unauthorized', descKey: 'errors.unauthorizedDesc' };
  }
  if (status === 403) {
    return { icon: ShieldOff, titleKey: 'errors.forbidden', descKey: 'errors.forbiddenDesc' };
  }
  if (status === 0 || e?.name === 'NetworkError') {
    return { icon: WifiOff, titleKey: 'errors.network', descKey: 'errors.networkDesc' };
  }
  return { icon: AlertTriangle, titleKey: 'errors.generic', descKey: 'errors.genericDesc' };
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  const { icon: Icon, titleKey, descKey } = classifyError(error);
  const e = error as Partial<ApiClientError>;
  const detail = e?.message;

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center"
    >
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-danger-50 text-danger-500 dark:bg-danger-500/10 [&_svg]:size-7">
        <Icon aria-hidden />
      </span>
      <div>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white">{t(titleKey)}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500 dark:text-graydark-600">
          {detail ?? t(descKey)}
        </p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('errors.retry')}
        </Button>
      )}
    </div>
  );
}

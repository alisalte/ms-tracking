/**
 * ErrorState — reusable error display for failed API queries.
 *
 * Renders a centered icon + message + retry button. Used by every page's
 * `isError` branch so a failed fetch never renders a blank screen.
 */
import { AlertTriangle, Lock, ShieldOff, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ApiClientError } from '@/api/errors';
import { Box, Button, Stack, Typography } from '@mui/material';

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
    <Stack
      alignItems="center"
      justifyContent="center"
      gap={2}
      sx={{
        py: 8,
        textAlign: 'center',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 64,
          height: 64,
          borderRadius: '50%',
          bgcolor: 'action.hover',
        }}
      >
        <Icon size={28} color="#EF4444" />
      </Box>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t(titleKey)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 360 }}>
          {detail ?? t(descKey)}
        </Typography>
      </Box>
      {onRetry && (
        <Button variant="outlined" size="small" onClick={onRetry}>
          {t('errors.retry')}
        </Button>
      )}
    </Stack>
  );
}

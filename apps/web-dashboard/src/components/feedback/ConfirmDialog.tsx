import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  open: boolean;
  /** Already-translated title. */
  title: ReactNode;
  /** Already-translated body message (e.g. "This action cannot be undone."). */
  message?: ReactNode;
  /** i18n key for the confirm button label (default "common.delete"). */
  confirmLabelKey?: string;
  /** i18n key for the cancel button label (default "common.cancel"). */
  cancelLabelKey?: string;
  /** Visual tone — danger renders a red confirm button. */
  tone?: 'danger' | 'default';
  /** Whether the underlying action is in-flight (disables both buttons). */
  loading?: boolean;
  /** Invoked when the user confirms. */
  onConfirm: () => void;
  /** Invoked when the user cancels / closes. */
  onClose: () => void;
}

/**
 * ConfirmDialog — a reusable confirmation dialog for destructive/irreversible
 * actions (primarily deletes).
 *
 * Renders a title + body ("This action cannot be undone." by default) +
 * `[Cancel] [Delete]` actions. The confirm button shows a pending label while
 * `loading` and is disabled.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabelKey = 'common.delete',
  cancelLabelKey = 'common.cancel',
  tone = 'danger',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const isDanger = tone === 'danger';

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {isDanger && <AlertTriangle size={20} color="var(--mui-palette-error-main)" />}
        {title}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {message ?? t('common.irreversible')}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
        <Stack direction="row" gap={1} sx={{ width: '100%' }}>
          <Button
            fullWidth
            variant="outlined"
            onClick={onClose}
            disabled={loading}
            sx={{ flex: 1 }}
          >
            {t(cancelLabelKey)}
          </Button>
          <Button
            fullWidth
            variant="contained"
            color={isDanger ? 'error' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
            sx={{ flex: 1 }}
          >
            {loading ? t('common.submitting') : t(confirmLabelKey)}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

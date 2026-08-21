import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Modal } from '@/components/tailwind-ui';

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
 * Tailwind implementation on the shared `Modal` primitive: title + body
 * ("This action cannot be undone." by default) + `[Cancel] [Delete]` actions.
 * The confirm button shows a pending label while `loading`.
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
    <Modal open={open} onClose={loading ? () => {} : onClose} title={title} size="sm">
      <div className="flex items-start gap-3">
        {isDanger && (
          <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-50 text-danger-600 dark:bg-danger-500/10 dark:text-danger-400">
            <TriangleAlert size={18} aria-hidden />
          </span>
        )}
        <p className="text-sm text-gray-600 dark:text-graydark-700">
          {message ?? t('common.irreversible')}
        </p>
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
          {t(cancelLabelKey)}
        </Button>
        <Button
          variant={isDanger ? 'danger' : 'primary'}
          className="flex-1"
          onClick={onConfirm}
          loading={loading}
        >
          {loading ? t('common.submitting') : t(confirmLabelKey)}
        </Button>
      </div>
    </Modal>
  );
}

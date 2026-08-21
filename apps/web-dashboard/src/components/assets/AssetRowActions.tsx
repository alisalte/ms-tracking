/**
 * AssetRowActions — the shared per-row action cluster for the asset tables.
 *
 * View is always available; Edit and the destructive action (archive /
 * decommission) are gated by the per-entity write permission via
 * `usePermissions` (the backend enforces the same strings). Icon buttons with
 * tooltips — no kebab menu, one click fewer.
 */
import { usePermissions } from '@/auth/permissions';
import { IconButton, Tooltip } from '@/components/tailwind-ui';
import type { LucideIcon } from 'lucide-react';
import { Archive, CircleSlash, Eye, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function AssetRowActions<T>({
  record,
  writePermission,
  onView,
  onEdit,
  onDelete,
  deleteIcon = 'archive',
}: {
  record: T;
  /** Permission gating the edit + destructive actions (e.g. `vehicle.write`). */
  writePermission: string;
  /** Open the entity detail drawer. */
  onView: (record: T) => void;
  /** Open the edit form (create/edit drawer). */
  onEdit?: (record: T) => void;
  /** Open the archive/decommission confirmation. */
  onDelete?: (record: T) => void;
  /** Destructive icon: archive (fleets/vehicles) or decommission (devices). */
  deleteIcon?: 'archive' | 'decommission';
}) {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const canWrite = can(writePermission);
  const DeleteIcon: LucideIcon = deleteIcon === 'archive' ? Archive : CircleSlash;
  const deleteLabel =
    deleteIcon === 'archive' ? t('assets.actions.archive') : t('assets.actions.decommission');

  return (
    <div
      className="flex items-center justify-end gap-0.5"
      onClick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <Tooltip label={t('common.view')}>
        <IconButton size="sm" variant="ghost" aria-label={t('common.view')} onClick={() => onView(record)}>
          <Eye size={15} />
        </IconButton>
      </Tooltip>
      {canWrite && onEdit && (
        <Tooltip label={t('common.edit')}>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t('common.edit')}
            onClick={() => onEdit(record)}
          >
            <Pencil size={15} />
          </IconButton>
        </Tooltip>
      )}
      {canWrite && onDelete && (
        <Tooltip label={deleteLabel}>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={deleteLabel}
            className="hover:text-danger-600 dark:hover:text-danger-400"
            onClick={() => onDelete(record)}
          >
            <DeleteIcon size={15} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}

import type { LucideIcon } from 'lucide-react';
import { Construction, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, EmptyState } from '@/components/tailwind-ui';
/**
 * UpcomingFeature — TailAdmin placeholder for features awaiting backend work.
 *
 * Renders a clear "coming soon" state with the feature name, description, and
 * the backend dependency. This follows the rule: "if the backend doesn't exist,
 * don't build a fake API — create a TODO + typed contract."
 */

interface UpcomingFeatureProps {
  /** Feature name (already translated). */
  title: string;
  /** Feature description (already translated). */
  description: string;
  /** The backend dependency that must land first. */
  backendDependency: string;
  /** Icon to display (lucide). */
  icon?: LucideIcon;
}

export function UpcomingFeature({
  title,
  description,
  backendDependency,
  icon: Icon = Construction,
}: UpcomingFeatureProps) {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={<Icon />}
      title={title}
      description={description}
      className="py-10"
      action={
        <div className="flex max-w-md flex-col items-center gap-3">
          <Badge color="gray">
            <Wrench size={12} aria-hidden />
            {t('common.backendDependency', { defaultValue: 'Waiting for backend:' })}{' '}
            {backendDependency}
          </Badge>
          <p className="text-xs text-gray-400 dark:text-graydark-600">
            {t('common.typedContractReady', {
              defaultValue: 'Typed contracts are defined and ready for integration.',
            })}
          </p>
        </div>
      }
    />
  );
}

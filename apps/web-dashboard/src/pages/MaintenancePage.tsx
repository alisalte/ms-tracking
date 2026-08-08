import { UpcomingFeature } from '@/components/common/UpcomingFeature';
/**
 * MaintenancePage — CMMS work orders and preventive maintenance (`/maintenance`).
 *
 * TODO: Backend dependency — no maintenance-service exists yet. The typed
 * contract is defined in `types/maintenance.types.ts`. When the backend lands,
 * this page will render the work order board, PM schedules, parts inventory,
 * and maintenance history.
 */
import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function MaintenancePage() {
  const { t } = useTranslation();
  return (
    <UpcomingFeature
      title={t('maintenance.title', { defaultValue: 'Maintenance' })}
      description={t('maintenance.description', {
        defaultValue:
          'Work orders, preventive maintenance schedules, parts inventory, and maintenance history.',
      })}
      backendDependency="vehicle-maintenance-service"
      icon={Wrench}
    />
  );
}

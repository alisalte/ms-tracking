import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { EmptyState } from '@/components/tailwind-ui';
import { DashboardCard } from './DashboardCard';

/**
 * MaintenanceStatusCard — dashboard slot for CMMS status + upcoming PM.
 *
 * vehicle-maintenance-service is not connected. This panel is an honest
 * placeholder (typed contract in `maintenance.types.ts`) with a link to the
 * existing /maintenance page — never fabricated work-order counts.
 */
export function MaintenanceStatusCard() {
  const { t } = useTranslation();

  return (
    <DashboardCard
      titleKey="dashboard.widgets.maintenanceStatus"
      accent="warning"
      icon={Wrench}
      action={
        <Link
          to="/maintenance"
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          {t('dashboard.maintenance.openPortal')}
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<Wrench />}
          title={t('dashboard.widgets.totalRequests')}
          description={t('dashboard.empty.maintenance')}
          className="py-4"
        />
        <div className="border-t border-gray-100 pt-3 dark:border-white/5">
          <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-graydark-700">
            {t('dashboard.widgets.upcomingPm')}
          </p>
          <p className="text-xs leading-5 text-gray-500 dark:text-graydark-600">
            {t('dashboard.empty.upcomingPm')}
          </p>
          <p className="mt-2 text-[11px] text-gray-400 dark:text-graydark-600">
            {t('dashboard.maintenance.waitingBackend')}
          </p>
        </div>
      </div>
    </DashboardCard>
  );
}

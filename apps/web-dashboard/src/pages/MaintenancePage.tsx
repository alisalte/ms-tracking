/**
 * MaintenancePage — CMMS work orders and preventive maintenance (`/maintenance`).
 *
 * Native work-order board is waiting on vehicle-maintenance-service. Until then
 * operators can open the partner CMMS portals (Pargar / Alka) from this page.
 */
import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import alkaLogo from '@/assets/partners/alka-cmms.png';
import pargarLogo from '@/assets/partners/pargar-cmms.png';
import { UpcomingFeature } from '@/components/common/UpcomingFeature';

const PARTNERS = [
  {
    id: 'pargar',
    href: 'https://pargarnet.com/',
    src: pargarLogo,
    nameKey: 'maintenance.partners.pargar',
    defaultName: 'Pargar CMMS',
  },
  {
    id: 'alka',
    href: 'https://pmem.ir/',
    src: alkaLogo,
    nameKey: 'maintenance.partners.alka',
    defaultName: 'Alka CMMS',
  },
] as const;

export function MaintenancePage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <UpcomingFeature
        title={t('maintenance.title', { defaultValue: 'Maintenance' })}
        description={t('maintenance.description', {
          defaultValue:
            'Work orders, preventive maintenance schedules, parts inventory, and maintenance history.',
        })}
        backendDependency="vehicle-maintenance-service"
        icon={Wrench}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-stretch justify-center gap-4 px-4 pb-8">
        {PARTNERS.map((partner) => (
          <a
            key={partner.id}
            href={partner.href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`maintenance-partner-${partner.id}`}
            aria-label={t(partner.nameKey, { defaultValue: partner.defaultName })}
            className="flex min-h-40 min-w-64 flex-1 cursor-pointer items-center justify-center rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm transition-colors hover:border-brand-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:border-white/10 dark:bg-graydark-300 dark:hover:bg-white/5"
          >
            <img
              src={partner.src}
              alt={t(partner.nameKey, { defaultValue: partner.defaultName })}
              className="max-h-28 w-auto max-w-full object-contain"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * ReportCatalog — first-class report cards on the overview so the suite
 * is visible without hunting through tabs.
 */
import {
  Activity,
  AlertTriangle,
  Clock,
  Fence,
  Gauge,
  Radio,
  Route,
  Shield,
  Terminal,
  Timer,
  Truck,
  Users,
  Waypoints,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  REPORT_CATALOG,
  REPORT_CATALOG_GROUPS,
  type ReportCatalogGroup,
  type ReportSection,
} from '@/lib/report-sections';

const ICONS: Record<Exclude<ReportSection, 'overview'>, LucideIcon> = {
  analytics: Shield,
  vehicles: Truck,
  drivers: Users,
  devices: Radio,
  distance: Route,
  speed: Gauge,
  stops: Clock,
  operation: Timer,
  odometer: Gauge,
  trips: Waypoints,
  alarms: AlertTriangle,
  geofences: Fence,
  commands: Terminal,
  activity: Activity,
};

export function ReportCatalog() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4" data-testid="report-catalog">
      <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
        {t('reports.catalog.title')}
      </h2>
      {REPORT_CATALOG_GROUPS.map((group) => {
        const items = REPORT_CATALOG.filter((c) => c.group === group);
        return (
          <div key={group} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-graydark-600">
              {t(`reports.catalog.${group as ReportCatalogGroup}`)}
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const Icon = ICONS[item.id];
                return (
                  <Link
                    key={item.id}
                    to={`/reports?section=${item.id}`}
                    data-testid={`report-catalog-${item.id}`}
                    className="flex gap-3 rounded-2xl border border-gray-200 bg-white p-3.5 no-underline transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-white/10 dark:bg-graydark-300 dark:hover:border-brand-500/40 dark:hover:bg-white/5"
                  >
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-300">
                      <Icon size={18} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-800 dark:text-white">
                        {t(`reports.sections.${item.id}`)}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-gray-500 dark:text-graydark-600">
                        {t(`reports.catalog.blurb.${item.id}`)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

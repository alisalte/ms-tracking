import type { TFunction } from 'i18next';
import {
  AlertOctagon,
  AlertTriangle,
  Battery,
  Gauge,
  MapPin,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useActiveAlerts } from '@/api/fleet.api';
import { status } from '@/theme/palette';
import type { AlertSeverity, AlertType } from '@/types/fleet.types';

import { WidgetCard } from './WidgetCard';

/** Icon per alert category. */
const ALERT_ICON: Record<AlertType, LucideIcon> = {
  overspeed: Gauge,
  idle: AlertTriangle,
  geofence: MapPin,
  fcw: ShieldAlert,
  dtc: Wrench,
  lowBattery: Battery,
};

/** Severity → semantic color token (status.red / amber / slate). */
const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: status.red,
  warning: status.amber,
  info: status.slate,
};

/** Relative time, locale-aware — keeps the live panel feeling fresh (§0.6). */
function relativeTime(iso: string, t: TFunction) {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return t('dashboard.relative.justNow');
  const min = Math.round(diffSec / 60);
  if (min < 60) return t('dashboard.relative.minutes', { count: min });
  const hr = Math.round(min / 60);
  return t('dashboard.relative.hours', { count: hr });
}

/**
 * ActiveAlertsPanel — live, severity-sorted alert feed.
 *
 * UI_UX_Design.md §1.4: WebSocket-fed panel sorted CRITICAL → warning → info,
 * each row showing a severity icon, type label, vehicle, and time. The footer
 * links to the full alert list. Colors use status.red / amber per §0.2.
 *
 * Tailwind surface; TanStack Query hook + alert-type icons unchanged.
 */
export function ActiveAlertsPanel() {
  const { t } = useTranslation();
  const { data, isLoading } = useActiveAlerts();
  const alerts = data ?? [];

  return (
    <WidgetCard
      titleKey="dashboard.widgets.activeAlerts"
      icon={AlertOctagon}
      live
      loading={isLoading}
      empty={alerts.length === 0 && !isLoading}
      emptyKey="dashboard.empty.alerts"
    >
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {alerts.slice(0, 6).map((alert) => {
          const Icon = ALERT_ICON[alert.type];
          const color = SEVERITY_COLOR[alert.severity];
          return (
            <li key={alert.id}>
              <Link to="/map" className="block no-underline">
                <span className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-white/5">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: `${color}1A`, color }}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-gray-800 dark:text-white">
                      {t(`dashboard.alerts.${alert.type}`)}
                      <span className="font-medium text-gray-500 dark:text-graydark-600">
                        {' · '}
                        {alert.vehicleLabel}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-gray-500 dark:text-graydark-600">
                      {alert.detail}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-[0.7rem] tabular-nums text-gray-500 dark:text-graydark-600">
                    {relativeTime(alert.occurredAt, t)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {alerts.length > 0 && (
        <Link
          to="/map"
          className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          {t('dashboard.widgets.viewAll', { count: alerts.length })} →
        </Link>
      )}
    </WidgetCard>
  );
}

import type { TFunction } from 'i18next';
import { AlertOctagon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useActiveAlarms } from '@/api/fleet.api';
import { alarmTypeIcon } from '@/components/alarms/AlarmTypeIcon';
import { Badge } from '@/components/tailwind-ui';
import { localizeAlarmMessage, localizeAlarmType, mapAlarmType } from '@/lib/alarm-copy';
import type { AlertSeverity, FleetAlert } from '@/types/fleet.types';

import { DashboardCard } from './DashboardCard';

/** Severity → tailwind badge tone + icon tint. */
const SEVERITY_TONE: Record<AlertSeverity, { badge: 'danger' | 'warning' | 'gray'; text: string }> =
  {
    critical: { badge: 'danger', text: 'text-danger-600 dark:text-danger-400' },
    warning: { badge: 'warning', text: 'text-warning-600 dark:text-warning-400' },
    info: { badge: 'gray', text: 'text-gray-500 dark:text-graydark-600' },
  };

/** Severity rank for the CRITICAL → warning → info sort (§1.4). */
const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

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

/** CRITICAL → warning → info, newest first within a severity (§1.4). */
export function sortAlerts(alerts: FleetAlert[]): FleetAlert[] {
  return [...alerts].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return Number(new Date(b.occurredAt)) - Number(new Date(a.occurredAt));
  });
}

/**
 * RecentEventsPanel — TailAdmin port of the severity-sorted alert feed
 * (Phase 4 "Recent Events" + "Alarm Summary").
 *
 * Same REAL source (notification-service via useActiveAlarms): a severity
 * summary chip row (critical / warning / informational counts), the latest six
 * events with type, vehicle, detail, and relative time, and a "view all" link
 * to alarm management (/alarms). Rows keep their original deep-link to the
 * live map. Honest error/empty states — never fabricated rows (§22).
 */
export function RecentEventsPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useActiveAlarms();
  const alerts = data ? sortAlerts(data) : [];

  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const warning = alerts.filter((a) => a.severity === 'warning').length;
  const info = alerts.filter((a) => a.severity === 'info').length;

  return (
    <DashboardCard
      titleKey="dashboard.sections.events"
      accent="danger"
      icon={AlertOctagon}
      live
      loading={isLoading && !isError}
      empty={alerts.length === 0 && !isLoading && !isError}
      emptyKey="dashboard.empty.alerts"
      error={isError ? error : undefined}
      onRetry={() => void refetch()}
      action={
        alerts.length > 0 ? (
          <Link
            to="/alarms"
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t('dashboard.widgets.viewAll', { count: alerts.length })} →
          </Link>
        ) : undefined
      }
    >
      <ul className="flex list-none flex-col gap-1 p-0">
        {alerts.slice(0, 6).map((alert) => {
          const catalogType = mapAlarmType(alert.type);
          const Icon = alarmTypeIcon(catalogType);
          const tone = SEVERITY_TONE[alert.severity];
          return (
            <li key={alert.id}>
              <Link to="/map" className="block no-underline">
                <span className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-white/5">
                  <span
                    className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-current/15 bg-current/10 [&_svg]:size-4 ${tone.text}`}
                  >
                    <Icon aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-gray-800 dark:text-graydark-800">
                      {localizeAlarmType(t, catalogType)}
                      <span className="font-medium text-gray-500 dark:text-graydark-600">
                        {' · '}
                        {alert.vehicleLabel}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-gray-500 dark:text-graydark-600">
                      {localizeAlarmMessage(t, {
                        type: catalogType,
                        message: alert.detail,
                        detail: alert.detail,
                      })}
                    </span>
                  </span>
                  <span className="text-xs whitespace-nowrap tabular-nums text-gray-400 dark:text-graydark-600">
                    {relativeTime(alert.occurredAt, t)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Alarm summary chips — severity counts at a glance */}
      {alerts.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-white/5">
          <Badge color="danger">
            {t('dashboard.severities.critical')}: {critical}
          </Badge>
          <Badge color="warning">
            {t('dashboard.severities.warning')}: {warning}
          </Badge>
          <Badge color="gray">
            {t('dashboard.severities.info')}: {info}
          </Badge>
        </div>
      )}
    </DashboardCard>
  );
}

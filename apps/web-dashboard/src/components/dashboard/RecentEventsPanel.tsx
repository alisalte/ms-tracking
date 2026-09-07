import type { TFunction } from 'i18next';
import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useActiveAlarms } from '@/api/fleet.api';
import { alarmTypeIcon } from '@/components/alarms/AlarmTypeIcon';
import { localizeAlarmMessage, localizeAlarmType, mapAlarmType } from '@/lib/alarm-copy';
import { formatTime } from '@/lib/format-date';
import type { AlertSeverity, FleetAlert } from '@/types/fleet.types';

import { DashboardCard } from './DashboardCard';

const SEVERITY_DOT: Record<AlertSeverity, string> = {
  critical: 'bg-danger-400',
  warning: 'bg-warning-400',
  info: 'bg-info-400',
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

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
 * RecentEventsPanel — live alarm/activity feed from notification-service.
 *
 * Navy timeline on the dashboard (reference layout). Honest empty/error;
 * never fabricated rows (§22).
 */
export function RecentEventsPanel() {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useActiveAlarms();
  const alerts = data ? sortAlerts(data) : [];

  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const warning = alerts.filter((a) => a.severity === 'warning').length;
  const info = alerts.filter((a) => a.severity === 'info').length;

  return (
    <DashboardCard
      titleKey="dashboard.sections.events"
      icon={Activity}
      variant="navy"
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
            className="text-xs font-semibold text-indigo-200 no-underline hover:text-white"
          >
            {t('dashboard.widgets.viewAllShort')} →
          </Link>
        ) : undefined
      }
    >
      <ul className="relative m-0 flex list-none flex-col gap-0 p-0">
        <span aria-hidden className="absolute start-[18px] top-2 bottom-2 w-px bg-white/10" />
        {alerts.slice(0, 7).map((alert) => {
          const catalogType = mapAlarmType(alert.type);
          const Icon = alarmTypeIcon(catalogType);
          return (
            <li key={alert.id}>
              <Link to="/map" className="block no-underline">
                <span className="relative grid grid-cols-[36px_1fr_auto] items-start gap-2.5 rounded-xl px-1 py-2 transition-colors hover:bg-white/5">
                  <span className="relative z-10 inline-flex size-9 items-center justify-center rounded-xl bg-white/8 text-white [&_svg]:size-4">
                    <span
                      aria-hidden
                      className={`absolute -end-0.5 -top-0.5 size-2 rounded-full ${SEVERITY_DOT[alert.severity]}`}
                    />
                    <Icon aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">
                      {localizeAlarmType(t, catalogType)}
                    </span>
                    <span className="block truncate text-xs text-indigo-200/80">
                      {alert.vehicleLabel}
                      {' · '}
                      {localizeAlarmMessage(t, {
                        type: catalogType,
                        message: alert.detail,
                        detail: alert.detail,
                      })}
                    </span>
                  </span>
                  <span className="pt-0.5 text-[11px] whitespace-nowrap tabular-nums text-indigo-200/70">
                    {formatTime(alert.occurredAt, undefined, i18n.language)}
                    <span className="mt-0.5 block text-end opacity-70">
                      {relativeTime(alert.occurredAt, t)}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {alerts.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3 text-[11px] text-indigo-100">
          <span>
            {t('dashboard.severities.critical')}: {critical}
          </span>
          <span>
            {t('dashboard.severities.warning')}: {warning}
          </span>
          <span>
            {t('dashboard.severities.info')}: {info}
          </span>
        </div>
      )}
    </DashboardCard>
  );
}

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

import { useActiveAlarms } from '@/api/fleet.api';
import { ErrorState } from '@/components/common/ErrorState';
import { status } from '@/theme/palette';
import type { AlertSeverity, AlertType, FleetAlert } from '@/types/fleet.types';

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
function sortAlerts(alerts: FleetAlert[]): FleetAlert[] {
  return [...alerts].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return Number(new Date(b.occurredAt)) - Number(new Date(a.occurredAt));
  });
}

/**
 * ActiveAlertsPanel — live, severity-sorted alert feed from the REAL
 * notification-service (`GET /notification/alerts` via useActiveAlarms).
 *
 * UI_UX_Design.md §1.4: sorted CRITICAL → warning → info, each row showing a
 * severity icon, type label, vehicle, and time. The footer links to the full
 * alert list. When the notification service is unreachable the panel shows an
 * honest error state with retry — never fabricated rows (§22).
 */
export function ActiveAlertsPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useActiveAlarms();
  const alerts = data ? sortAlerts(data) : [];

  return (
    <WidgetCard
      titleKey="dashboard.widgets.activeAlerts"
      icon={AlertOctagon}
      live
      loading={isLoading && !isError}
      empty={alerts.length === 0 && !isLoading && !isError}
      emptyKey="dashboard.empty.alerts"
    >
      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {alerts.slice(0, 6).map((alert) => {
              const Icon = ALERT_ICON[alert.type];
              const color = SEVERITY_COLOR[alert.severity];
              return (
                <li key={alert.id}>
                  <Link
                    to="/map"
                    style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                  >
                    <span
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto',
                        alignItems: 'center',
                        gap: 12,
                        padding: '8px 4px',
                        borderRadius: 6,
                      }}
                      className="fv-alert-row"
                    >
                      <span
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          background: `linear-gradient(135deg, ${color}33, ${color}12)`,
                          border: `1px solid ${color}40`,
                          color,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={16} />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: 'block',
                            fontSize: '0.8125rem',
                            fontWeight: 600,
                            color: 'var(--mui-palette-text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {t(`dashboard.alerts.${alert.type}`)}
                          <span
                            style={{ color: 'var(--mui-palette-text-secondary)', fontWeight: 500 }}
                          >
                            {' · '}
                            {alert.vehicleLabel}
                          </span>
                        </span>
                        <span
                          style={{
                            display: 'block',
                            fontSize: '0.75rem',
                            color: 'var(--mui-palette-text-secondary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {alert.detail}
                        </span>
                      </span>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--mui-palette-text-secondary)',
                          whiteSpace: 'nowrap',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
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
              style={{
                display: 'inline-block',
                marginTop: 8,
                fontSize: '0.8rem',
                fontWeight: 600,
                textDecoration: 'none',
                color: 'var(--mui-palette-primary-main)',
              }}
            >
              {t('dashboard.widgets.viewAll', { count: alerts.length })} →
            </Link>
          )}
        </>
      )}
    </WidgetCard>
  );
}

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
                      <span style={{ color: 'var(--mui-palette-text-secondary)', fontWeight: 500 }}>
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
    </WidgetCard>
  );
}

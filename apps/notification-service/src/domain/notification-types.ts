/**
 * Notification type definitions — channels, severity, status, categories.
 *
 * The channel union includes SMS/push/webhook for interface completeness;
 * only websocket/in_app/email have concrete providers today.
 */

export type NotificationCategory =
  | 'alarm'
  | 'trip'
  | 'maintenance'
  | 'compliance'
  | 'system'
  | 'billing';

export type NotificationSeverity = 'critical' | 'high' | 'normal' | 'low';

export type NotificationChannel = 'websocket' | 'in_app' | 'email' | 'sms' | 'push' | 'webhook';

export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'READ';

/**
 * Delivery priority — derived deterministically from notification severity
 * (Sprint H §25 mapping):
 *   critical → urgent, high → high, normal → normal, low → low.
 * Priority influences channel ordering only; it does NOT create queues.
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Severity rank for preference filtering (higher = more urgent). */
export const notifSeverityRank: Record<NotificationSeverity, number> = {
  critical: 3,
  high: 2,
  normal: 1,
  low: 0,
};

/** Deterministic severity → priority mapping (documented Sprint H §25). */
export function severityToPriority(severity: NotificationSeverity): NotificationPriority {
  switch (severity) {
    case 'critical':
      return 'urgent';
    case 'high':
      return 'high';
    case 'normal':
      return 'normal';
    default:
      return 'low';
  }
}

/** Default channels when no preference is set. */
export const DEFAULT_CHANNELS: NotificationChannel[] = ['websocket', 'in_app'];

/** Default minimum severity when no preference is set. */
export const DEFAULT_MIN_SEVERITY: NotificationSeverity = 'normal';

/** Map AlarmSeverity (INFO/LOW/MEDIUM/HIGH/CRITICAL) to NotificationSeverity. */
export function mapAlarmSeverity(alarm: string): NotificationSeverity {
  if (alarm === 'CRITICAL') return 'critical';
  if (alarm === 'HIGH') return 'high';
  if (alarm === 'MEDIUM') return 'normal';
  return 'low';
}

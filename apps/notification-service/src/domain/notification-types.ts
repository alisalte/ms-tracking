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

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'READ';

/** Severity rank for preference filtering (higher = more urgent). */
export const notifSeverityRank: Record<NotificationSeverity, number> = {
  critical: 3,
  high: 2,
  normal: 1,
  low: 0,
};

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

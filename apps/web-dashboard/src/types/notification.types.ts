/**
 * Notification domain types — typed contract.
 *
 * TODO: No notification-service exists yet. These types define the contract
 * for when the backend lands notification endpoints.
 *
 * Source: docs/modules/Notification-Alerting.md.
 */

/** Notification severity. */
export type NotificationSeverity = 'critical' | 'high' | 'normal' | 'low';

/** Notification category. */
export type NotificationCategory =
  | 'alarm'
  | 'trip'
  | 'maintenance'
  | 'compliance'
  | 'system'
  | 'billing';

/** A notification item (in-app bell dropdown). */
export interface Notification {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  read: boolean;
  /** ISO timestamp. */
  createdAt: string;
  /** Optional deep link (e.g. /alarms/al-123). */
  link?: string;
  /** Optional icon key. */
  icon?: string;
}

/** Unread count response. */
export interface UnreadCount {
  total: number;
  critical: number;
  high: number;
}

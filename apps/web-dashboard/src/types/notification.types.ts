/**
 * Notification domain types — typed contract with notification-service.
 *
 * Source: docs/modules/Notification-Alerting.md + Sprint H Notification Center.
 */

/** Notification severity. */
export type NotificationSeverity = 'critical' | 'high' | 'normal' | 'low';

/** Notification priority — derived from severity (Sprint H §25). */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Notification category. */
export type NotificationCategory =
  | 'alarm'
  | 'trip'
  | 'maintenance'
  | 'compliance'
  | 'system'
  | 'billing';

/** Notification channel. */
export type NotificationChannel = 'websocket' | 'in_app' | 'email' | 'sms' | 'push' | 'webhook';

/** A notification item (in-app bell dropdown). */
export interface Notification {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  priority: NotificationPriority;
  category: NotificationCategory;
  /** Alarm/event type (overspeed, geofence_enter, …). */
  eventType: string;
  vehicleId?: string;
  read: boolean;
  /** ISO timestamp. */
  createdAt: string;
  /** Optional deep link (e.g. /alarms?id=...). */
  link?: string;
  /** Optional icon key. */
  icon?: string;
}

/** Delivery attempt record for one channel (Sprint H §30). */
export interface NotificationDeliveryInfo {
  id: string;
  channel: NotificationChannel;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'READ';
  attempts: number;
  error: string | null;
  provider: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

/** Notification detail incl. its delivery attempts timeline. */
export interface NotificationDetail extends Notification {
  deliveries: NotificationDeliveryInfo[];
}

/** Per-user notification preference. */
export interface NotificationPreference {
  category: string;
  minSeverity: NotificationSeverity;
  channels: NotificationChannel[];
  enabled: boolean;
}

/** Channel provider readiness (Sprint H §48). */
export interface ChannelHealth {
  channel: string;
  provider: string;
  status: 'CONFIGURED' | 'DISABLED' | 'UNAVAILABLE';
}

/** Unread count response. */
export interface UnreadCount {
  total: number;
  critical: number;
  high: number;
}

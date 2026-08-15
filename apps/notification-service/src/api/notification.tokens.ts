/**
 * DI tokens for notification-service — kept separate from the module file to
 * avoid controller ↔ module circular imports (TDZ on token initialization).
 */

/** Configuration-driven channel → provider registry (Sprint H §14). */
export const NOTIFICATION_PROVIDER_REGISTRY = 'NOTIFICATION_PROVIDER_REGISTRY';

/** WS gateway instance (alarm + notification realtime push). */
export const ALARM_REALTIME_GATEWAY = 'ALARM_REALTIME_GATEWAY';

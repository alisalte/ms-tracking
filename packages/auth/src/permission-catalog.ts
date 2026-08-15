/**
 * IAM permission catalog — the platform-wide single source of truth for
 * permission strings issued and enforced across every service (docs/specs/02
 * §6.1). identity-service embeds these in the JWT; downstream services enforce
 * them via `@RequirePermissions`. Format: `<domain>.<resource>[.sub].<action>`.
 *
 * Sprint B adds the downstream-service permissions required by existing
 * endpoints only (no speculative future catalog) — `tracking.*`, `maps.*`,
 * `media.*`, and the gateway-admin `telemetry.gateway.manage`.
 *
 * Wildcard `*` covers all (granted only to the system `tenant-admin` role).
 */

export const Permissions = {
  // --- User management (identity) ---
  USER_READ: 'iam.user.read',
  USER_CREATE: 'iam.user.create',
  USER_UPDATE: 'iam.user.update',
  USER_MANAGE: 'iam.user.manage', // status transitions, lock/unlock
  // --- Role management (identity) ---
  ROLE_READ: 'iam.role.read',
  ROLE_CREATE: 'iam.role.create',
  ROLE_UPDATE: 'iam.role.update',
  ROLE_DELETE: 'iam.role.delete',
  ROLE_ASSIGN: 'iam.role.assign',
  ROLE_REVOKE: 'iam.role.revoke',
  // --- Organization management (identity) ---
  ORG_READ: 'iam.org.read',
  ORG_CREATE: 'iam.org.create',
  ORG_UPDATE: 'iam.org.update',
  ORG_MANAGE: 'iam.org.manage',
  // --- API keys (identity) ---
  APIKEY_READ: 'iam.apikey.read',
  APIKEY_CREATE: 'iam.apikey.create',
  APIKEY_REVOKE: 'iam.apikey.revoke',
  // --- Permissions introspection ---
  PERMISSION_READ: 'iam.permission.read',
  // --- Audit ---
  AUDIT_READ: 'audit.read',
  // --- Tenant (platform SaaS-Ops) ---
  TENANT_READ: 'billing.tenant.read',
  TENANT_MANAGE: 'billing.tenant.manage',

  // --- Tracking (gps-engine) — Sprint B ---
  TRACKING_READ: 'tracking.read', // positions + device status
  // --- Map (map-engine) — Sprint B ---
  MAPS_READ: 'maps.read', // POI/geofence/address/route/cluster/replay reads
  MAPS_WRITE: 'maps.write', // POI/geofence create + delete
  // --- Media (media-service) — Sprint B ---
  MEDIA_READ: 'media.read', // channel reads
  MEDIA_WRITE: 'media.write', // stream/channel create + delete
  // --- Device gateway administration — Sprint B ---
  GATEWAY_MANAGE: 'telemetry.gateway.manage', // admin/control API (NOT device protocol)

  // --- Fleet management (fleet-management-service) — Sprint C ---
  FLEET_READ: 'fleet.read', // fleet reads
  FLEET_WRITE: 'fleet.write', // fleet create + update + archive
  VEHICLE_READ: 'vehicle.read', // vehicle reads
  VEHICLE_WRITE: 'vehicle.write', // vehicle create + update + archive + bind/unbind
  DEVICE_READ: 'device.read', // device reads
  DEVICE_WRITE: 'device.write', // device create + update + disable + bind/unbind
  // Service-only: IMEI → device identity resolution for the device-gateway. Granted
  // to NO user system role — only the gateway's service API key carries it, and the
  // resolve endpoint additionally rejects JWTs (API-key-only). Prevents cross-tenant
  // device enumeration by any user (including tenant-admin's wildcard).
  DEVICE_REGISTRY_RESOLVE: 'device.registry.resolve',

  // --- Alarm/Event engine (notification-service) — Sprint G ---
  NOTIFICATION_ALERT_READ: 'notification.alert.read', // alarm list/detail + in-app notifications
  NOTIFICATION_ALERT_ACK: 'notification.alert.ack', // acknowledge alarms
  NOTIFICATION_ALERT_RESOLVE: 'notification.alert.resolve', // resolve alarms
  NOTIFICATION_RULE_READ: 'notification.rule.read', // alarm rule reads
  NOTIFICATION_RULE_CREATE: 'notification.rule.create',
  NOTIFICATION_RULE_UPDATE: 'notification.rule.update', // update + enable/disable
  NOTIFICATION_RULE_DELETE: 'notification.rule.delete',
  NOTIFICATION_EVENT_READ: 'notification.event.read', // FleetEvent history reads

  // --- Notification Center (notification-service) — Sprint H ---
  NOTIFICATION_READ: 'notification.read', // own notification bell/center reads + mark read
  NOTIFICATION_READ_ALL: 'notification.read.all', // tenant-wide notification history
  NOTIFICATION_PREFERENCE_READ: 'notification.preference.read', // own preference reads
  NOTIFICATION_PREFERENCE_WRITE: 'notification.preference.write', // own preference updates
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

/**
 * Back-compat alias — identity-service historically calls this `IamPermissions`.
 * Kept so existing call sites keep compiling after the catalog was promoted here.
 */
export const IamPermissions = Permissions;

/** The platform-wide wildcard — granted only to the per-tenant `tenant-admin`. */
export const WILDCARD_PERMISSION = '*';

/** All enumerable permissions (used to seed/validate system roles). */
export const ALL_PERMISSIONS: readonly string[] = Object.values(Permissions);

/**
 * Does a granted permission set satisfy the required permission?
 * Wildcard (`*`) grants everything; otherwise an exact match is required.
 * (OPA is the authoritative evaluator in production; this is the in-process
 * fallback used by the PermissionsGuard before OPA lands.)
 */
export function permissionSatisfies(granted: readonly string[], required: string): boolean {
  if (granted.includes(WILDCARD_PERMISSION)) return true;
  return granted.includes(required);
}

/**
 * Default system roles seeded per tenant (docs/specs/02 §6.2). `tenant-admin`
 * carries the wildcard. Sprint B grants the new downstream read permissions to
 * `viewer` and the read+write set to `fleet-admin` so non-admin roles can use
 * the downstream services once a tenant is (re)provisioned.
 */
export interface SystemRoleSeed {
  readonly name: string;
  readonly permissions: readonly string[];
  readonly mfaRequired: boolean;
}

export const SYSTEM_ROLES: readonly SystemRoleSeed[] = [
  { name: 'tenant-admin', permissions: [WILDCARD_PERMISSION], mfaRequired: true },
  {
    name: 'fleet-admin',
    permissions: [
      Permissions.USER_READ,
      Permissions.USER_CREATE,
      Permissions.USER_UPDATE,
      Permissions.ROLE_READ,
      Permissions.ROLE_ASSIGN,
      Permissions.ROLE_REVOKE,
      Permissions.ORG_READ,
      Permissions.APIKEY_READ,
      Permissions.APIKEY_CREATE,
      Permissions.APIKEY_REVOKE,
      Permissions.AUDIT_READ,
      // Sprint B — downstream service access for fleet administrators.
      Permissions.TRACKING_READ,
      Permissions.MAPS_READ,
      Permissions.MAPS_WRITE,
      Permissions.MEDIA_READ,
      Permissions.MEDIA_WRITE,
      // Sprint C — fleet management (fleets/vehicles/devices).
      Permissions.FLEET_READ,
      Permissions.FLEET_WRITE,
      Permissions.VEHICLE_READ,
      Permissions.VEHICLE_WRITE,
      Permissions.DEVICE_READ,
      Permissions.DEVICE_WRITE,
      // Sprint G — alarm engine administration (rules + lifecycle actions).
      Permissions.NOTIFICATION_ALERT_READ,
      Permissions.NOTIFICATION_ALERT_ACK,
      Permissions.NOTIFICATION_ALERT_RESOLVE,
      Permissions.NOTIFICATION_RULE_READ,
      Permissions.NOTIFICATION_RULE_CREATE,
      Permissions.NOTIFICATION_RULE_UPDATE,
      Permissions.NOTIFICATION_RULE_DELETE,
      Permissions.NOTIFICATION_EVENT_READ,
      // Sprint H — notification center incl. tenant-wide history.
      Permissions.NOTIFICATION_READ,
      Permissions.NOTIFICATION_READ_ALL,
      Permissions.NOTIFICATION_PREFERENCE_READ,
      Permissions.NOTIFICATION_PREFERENCE_WRITE,
    ],
    mfaRequired: false,
  },
  {
    name: 'viewer',
    permissions: [
      Permissions.USER_READ,
      Permissions.ROLE_READ,
      Permissions.ORG_READ,
      Permissions.APIKEY_READ,
      Permissions.AUDIT_READ,
      // Sprint B — read-only downstream access for viewers.
      Permissions.TRACKING_READ,
      Permissions.MAPS_READ,
      Permissions.MEDIA_READ,
      // Sprint C — read-only fleet management access.
      Permissions.FLEET_READ,
      Permissions.VEHICLE_READ,
      Permissions.DEVICE_READ,
      // Sprint G — read-only alarm/event visibility (no lifecycle actions).
      Permissions.NOTIFICATION_ALERT_READ,
      Permissions.NOTIFICATION_RULE_READ,
      Permissions.NOTIFICATION_EVENT_READ,
      // Sprint H — own notification bell/center + own preferences.
      Permissions.NOTIFICATION_READ,
      Permissions.NOTIFICATION_PREFERENCE_READ,
      Permissions.NOTIFICATION_PREFERENCE_WRITE,
    ],
    mfaRequired: false,
  },
];

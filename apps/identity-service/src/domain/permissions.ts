/**
 * IAM permission catalog — the single source of truth for permission strings
 * this service issues and enforces (docs/specs/02_Domain_Model.md §6.1). The
 * gateway/OPA consumes the same strings; CI drift checks (ARR SEC-1) ensure
 * endpoints declare only catalog permissions.
 *
 * Format: `<domain>.<resource>[.sub-resource].<action>`. Wildcard `*` covers
 * all (used by the system `tenant-admin` role).
 */

export const IamPermissions = {
  // User management
  USER_READ: 'iam.user.read',
  USER_CREATE: 'iam.user.create',
  USER_UPDATE: 'iam.user.update',
  USER_MANAGE: 'iam.user.manage', // status transitions, lock/unlock
  // Role management
  ROLE_READ: 'iam.role.read',
  ROLE_CREATE: 'iam.role.create',
  ROLE_UPDATE: 'iam.role.update',
  ROLE_DELETE: 'iam.role.delete',
  ROLE_ASSIGN: 'iam.role.assign',
  ROLE_REVOKE: 'iam.role.revoke',
  // Organization management
  ORG_READ: 'iam.org.read',
  ORG_CREATE: 'iam.org.create',
  ORG_UPDATE: 'iam.org.update',
  ORG_MANAGE: 'iam.org.manage',
  // API keys
  APIKEY_READ: 'iam.apikey.read',
  APIKEY_CREATE: 'iam.apikey.create',
  APIKEY_REVOKE: 'iam.apikey.revoke',
  // Permissions introspection
  PERMISSION_READ: 'iam.permission.read',
  // Audit
  AUDIT_READ: 'audit.read',
  // Tenant (platform SaaS-Ops)
  TENANT_READ: 'billing.tenant.read',
  TENANT_MANAGE: 'billing.tenant.manage',
  // Telemetry gateway administration (device-gateway /admin/* endpoints)
  GATEWAY_MANAGE: 'telemetry.gateway.manage',
  // Alarm / Alert lifecycle (notification-service, 12_Alarm_Engine.md §5/§6)
  ALERT_READ: 'notification.alert.read',
  ALERT_ACKNOWLEDGE: 'notification.alert.ack',
  ALERT_RESOLVE: 'notification.alert.resolve',
  // Alarm rule management
  ALERT_RULE_READ: 'notification.rule.read',
  ALERT_RULE_CREATE: 'notification.rule.create',
  ALERT_RULE_UPDATE: 'notification.rule.update',
  ALERT_RULE_DELETE: 'notification.rule.delete',
  // Fleet — Driver management (Sprint 6)
  DRIVER_READ: 'fleet.driver.read',
  DRIVER_CREATE: 'fleet.driver.create',
  DRIVER_UPDATE: 'fleet.driver.update',
  DRIVER_MANAGE: 'fleet.driver.manage',
  // Fleet — Business Trip management
  TRIP_READ: 'fleet.trip.read',
  TRIP_CREATE: 'fleet.trip.create',
  TRIP_UPDATE: 'fleet.trip.update',
} as const;

export type IamPermission = (typeof IamPermissions)[keyof typeof IamPermissions];

/** The platform-wide wildcard — granted only to the per-tenant `tenant-admin`. */
export const WILDCARD_PERMISSION = '*';

/** All enumerable IAM permissions (used to seed system roles). */
export const ALL_IAM_PERMISSIONS: readonly string[] = Object.values(IamPermissions);

/**
 * Does a role's permission set satisfy the required permission?
 * Wildcard (`*`) grants everything; otherwise an exact match is required.
 * (OPA is the authoritative evaluator in production; this is the in-process
 * fallback used by the PermissionsGuard before OPA lands.)
 */
export function permissionSatisfies(granted: readonly string[], required: string): boolean {
  if (granted.includes(WILDCARD_PERMISSION)) return true;
  return granted.includes(required);
}

/**
 * Default system roles seeded per tenant (docs/specs/02_Domain_Model.md §6.2).
 * `tenant-admin` carries the wildcard and mandates MFA (enforced elsewhere).
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
      IamPermissions.USER_READ,
      IamPermissions.USER_CREATE,
      IamPermissions.USER_UPDATE,
      IamPermissions.ROLE_READ,
      IamPermissions.ROLE_ASSIGN,
      IamPermissions.ROLE_REVOKE,
      IamPermissions.ORG_READ,
      IamPermissions.APIKEY_READ,
      IamPermissions.APIKEY_CREATE,
      IamPermissions.APIKEY_REVOKE,
      IamPermissions.AUDIT_READ,
      // Alarm lifecycle (12_Alarm_Engine.md §5/§6)
      IamPermissions.ALERT_READ,
      IamPermissions.ALERT_ACKNOWLEDGE,
      IamPermissions.ALERT_RESOLVE,
      IamPermissions.ALERT_RULE_READ,
      IamPermissions.ALERT_RULE_CREATE,
      IamPermissions.ALERT_RULE_UPDATE,
      IamPermissions.ALERT_RULE_DELETE,
      // Fleet management (Sprint 6)
      IamPermissions.DRIVER_READ,
      IamPermissions.DRIVER_CREATE,
      IamPermissions.DRIVER_UPDATE,
      IamPermissions.DRIVER_MANAGE,
      IamPermissions.TRIP_READ,
      IamPermissions.TRIP_CREATE,
      IamPermissions.TRIP_UPDATE,
    ],
    mfaRequired: false,
  },
  {
    name: 'viewer',
    permissions: [
      IamPermissions.USER_READ,
      IamPermissions.ROLE_READ,
      IamPermissions.ORG_READ,
      IamPermissions.APIKEY_READ,
      IamPermissions.AUDIT_READ,
      // Alarm read-only
      IamPermissions.ALERT_READ,
      IamPermissions.ALERT_RULE_READ,
      // Fleet read-only
      IamPermissions.DRIVER_READ,
      IamPermissions.TRIP_READ,
    ],
    mfaRequired: false,
  },
];

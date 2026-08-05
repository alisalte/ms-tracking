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
    ],
    mfaRequired: false,
  },
];

/**
 * Administration domain types (UI-facing, camelCase).
 *
 * Mirrors the entity models from `docs/modules/Identity-Access-Management.md`
 * (User §3.1, Role, RoleBinding), the canonical permission catalog + system
 * roles (`docs/specs/02_Domain_Model.md` §6), tenant Settings (UI_UX §5.2),
 * and the AuditEntry (`docs/modules/Audit-Compliance-Log.md` §3.1). The wire
 * (`*Wire`) snake_case variants will be added here when the `identity-service`
 * (`/api/v1/iam`) + `audit-log-service` (`/api/v1/audit`) endpoints land; today
 * the Admin Panel reads from static mock data (`mock/admin-data.ts`) so the UI
 * is fully demoable.
 *
 * Color semantics live in `theme/palette.ts` (`status.*`); the string status
 * keys here map to those tokens so the UI never hardcodes hex values.
 */

// ── Users (IAM §3.1) ──────────────────────────────────────────────────────────

/** User lifecycle status (IAM §3.1 UserStatus; matches auth.types for parity). */
export type AdminUserStatus = 'active' | 'suspended' | 'deactivated' | 'locked';

/** Authentication provider (IAM §3.1 AuthProvider). */
export type AuthProvider = 'local' | 'sso' | 'scim';

/** A managed user (IAM §3.1 User aggregate, UI subset). */
export interface AdminUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  status: AdminUserStatus;
  /** Role ids bound to the user (IAM §3.1 RoleBinding). */
  roleIds: string[];
  /** Primary role display name (for the table). */
  roleName: string;
  mfaEnabled: boolean;
  lastLoginAt?: string;
  authProvider: AuthProvider;
  createdAt: string;
}

// ── Roles & Permissions (02_Domain_Model §6) ─────────────────────────────────

/** A role — system-seeded or tenant-custom (§6.2). */
export interface Role {
  id: string;
  name: string;
  description: string;
  /** System roles are seeded per tenant and cannot be deleted. */
  isSystem: boolean;
  /** Canonical permission keys granted by the role (§6.1 catalog). */
  permissionKeys: string[];
  memberCount: number;
  /** Whether MFA is mandatory for the role (§6.2 MFA column). */
  mfaRequired: boolean;
}

/** A permission-catalog group — one per domain (§6.1). */
export interface PermissionGroup {
  /** Domain prefix, e.g. `iam`, `fleet`. */
  domain: string;
  /** i18n key for the domain label. */
  labelKey: string;
  /** Canonical permission keys in this domain. */
  permissions: string[];
}

// ── Tenant Settings (UI_UX §5.2) ─────────────────────────────────────────────

/** Distance unit preference. */
export type DistanceUnit = 'km' | 'mi';
/** Volume unit preference. */
export type VolumeUnit = 'L' | 'gal';
/** Temperature unit preference. */
export type TempUnit = 'C' | 'F';

/** Tenant-level settings (UI_UX §5.2 Settings). */
export interface TenantSettings {
  locale: string;
  timezone: string;
  distanceUnit: DistanceUnit;
  volumeUnit: VolumeUnit;
  tempUnit: TempUnit;
  dateFormat: string;
  orgName: string;
  /** Data-retention preview (days) — links to Audit retention policies. */
  retentionDays: number;
}

// ── Audit (Audit-Compliance-Log §3.1) ────────────────────────────────────────

/** Audit action (Audit §3.1 AuditAction, lower-cased for UI keys). */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'read'
  | 'execute'
  | 'login'
  | 'logout'
  | 'authorize'
  | 'deny'
  | 'export'
  | 'import'
  | 'config_change'
  | 'system';

/** Audit business category (Audit §3.1 AuditCategory, lower-cased). */
export type AuditCategory =
  | 'authentication'
  | 'authorization'
  | 'fleet'
  | 'vehicle'
  | 'driver'
  | 'trip'
  | 'fuel'
  | 'maintenance'
  | 'compliance'
  | 'notification'
  | 'billing'
  | 'tenant'
  | 'analytics'
  | 'asset'
  | 'system';

/** Actor type (Audit §3.1 ActorType). */
export type AuditActorType = 'user' | 'service' | 'system' | 'anonymous';

/** An immutable audit log entry (Audit §3.1 AuditEntry, UI subset). */
export interface AuditEntry {
  id: string;
  /** ISO timestamp of the action (from the source event). */
  timestamp: string;
  action: AuditAction;
  category: AuditCategory;
  /** Display name of the actor (user/service/system). */
  actorName: string;
  actorType: AuditActorType;
  /** What was acted upon (entity type + id). */
  targetType: string;
  targetId: string;
  sourceService: string;
  ipAddress?: string;
  /** Distributed-trace correlation id. */
  correlationId: string;
  /** SHA-256 chain hash (integrity, Audit §3.1 integrityHash). */
  integrityHash: string;
}

/** The active Admin Panel section (URL-synced). */
export type AdminSection =
  | 'organization'
  | 'users'
  | 'roles'
  | 'fleets'
  | 'devices'
  | 'geofences'
  | 'policies'
  | 'notifications'
  | 'integrations'
  | 'apikeys'
  | 'billing'
  | 'audit'
  | 'settings'
  | 'permissions';

/** Tenant self-view (`GET /tenant`). */
export interface TenantInfo {
  id: string;
  name: string;
  tier: string;
  region: string;
  status: string;
}

/** API key list row (`GET /auth/api-keys`). The plaintext is never listed. */
export interface AdminApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  status: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

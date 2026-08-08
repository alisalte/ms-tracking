/**
 * Admin visual helpers — single source of truth for the status→color maps
 * shared by the Users, Roles, and Audit sections. Colors come from the semantic
 * palette (`theme/palette.ts` `status.*`).
 */
import { status } from '@/theme/palette';
import type { AdminUserStatus, AuditAction } from '@/types/admin.types';

/** User status → semantic color (IAM §3.1 UserStatus). */
export function userStatusColor(s: AdminUserStatus): string {
  switch (s) {
    case 'active':
      return status.green;
    case 'suspended':
      return status.amber;
    case 'locked':
      return status.red;
    default:
      return status.slate;
  }
}

/** Audit action → semantic color (Audit §3.1 AuditAction). */
export function auditActionColor(a: AuditAction): string {
  switch (a) {
    case 'delete':
      return status.red;
    case 'create':
      return status.green;
    case 'update':
    case 'config_change':
      return status.amber;
    case 'deny':
      return status.red;
    case 'login':
    case 'logout':
      return status.blue;
    default:
      return status.slate;
  }
}

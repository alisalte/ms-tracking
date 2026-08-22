/**
 * Admin visual helpers — single source of truth for the status→color maps
 * shared by the Users and Audit sections. Values are tailwind `Badge` color
 * names so the UI never hardcodes hex values.
 */
import type { BadgeProps } from '@/components/tailwind-ui';
import type { AdminUserStatus, AuditAction } from '@/types/admin.types';

/** User status → semantic color (IAM §3.1 UserStatus). */
export function userStatusColor(s: AdminUserStatus): BadgeProps['color'] {
  switch (s) {
    case 'active':
      return 'success';
    case 'suspended':
      return 'warning';
    case 'locked':
      return 'danger';
    default:
      return 'gray';
  }
}

/** Audit action → semantic color (Audit §3.1 AuditAction). */
export function auditActionColor(a: AuditAction): BadgeProps['color'] {
  switch (a) {
    case 'delete':
      return 'danger';
    case 'create':
      return 'success';
    case 'update':
    case 'config_change':
      return 'warning';
    case 'deny':
      return 'danger';
    case 'login':
    case 'logout':
      return 'info';
    default:
      return 'gray';
  }
}

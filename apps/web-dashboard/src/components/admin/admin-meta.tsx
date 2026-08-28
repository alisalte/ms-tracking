/**
 * Admin visual helpers — single source of truth for the status→color maps
 * shared by the Users and Audit sections. Values are tailwind `Badge` color
 * names so the UI never hardcodes hex values.
 */
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';

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

/** Jump from an admin registry table to the full working page. */
export function AdminPageLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
    >
      {label}
      <ArrowUpRight size={14} aria-hidden />
    </Link>
  );
}

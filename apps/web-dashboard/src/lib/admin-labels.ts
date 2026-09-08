/**
 * Operator-facing labels for IAM roles and permission keys.
 *
 * Catalog keys stay English in the API (`iam.user.read`); the admin UI shows a
 * localized name and keeps the technical key as secondary text.
 */
import type { TFunction } from 'i18next';

const SYSTEM_ROLE_NAMES = ['tenant-admin', 'fleet-admin', 'viewer'] as const;
type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

function isSystemRoleName(name: string): name is SystemRoleName {
  return (SYSTEM_ROLE_NAMES as readonly string[]).includes(name);
}

function asStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, string>;
}

/** Localized label for a catalog permission key; falls back to the key itself. */
export function permissionLabel(t: TFunction, key: string): string {
  const labels = asStringRecord(t('admin.permissions.keys', { returnObjects: true }));
  const label = labels?.[key];
  return typeof label === 'string' && label.length > 0 ? label : key;
}

/** Localized name for seeded system roles; custom roles keep their stored name. */
export function roleDisplayName(t: TFunction, name: string): string {
  if (isSystemRoleName(name)) return t(`admin.roles.systemNames.${name}`);
  return name;
}

/** Localized description for seeded system roles (replaces `System role: …`). */
export function roleDisplayDescription(t: TFunction, name: string, fallback: string): string {
  if (isSystemRoleName(name)) return t(`admin.roles.systemDescriptions.${name}`);
  const match = /^System role:\s*(.+)$/i.exec(fallback.trim());
  const slug = match?.[1]?.trim();
  if (slug && isSystemRoleName(slug)) return t(`admin.roles.systemDescriptions.${slug}`);
  return fallback;
}

/** Resolve role ids (or leftover English placeholders) to a display string. */
export function userRoleLabel(
  t: TFunction,
  roleIds: readonly string[],
  roles: readonly { id: string; name: string }[],
  fallbackName?: string,
): string {
  const names = roleIds
    .map((id) => roles.find((r) => r.id === id)?.name)
    .filter((n): n is string => Boolean(n));
  if (names.length > 0) {
    return names.map((n) => roleDisplayName(t, n)).join(t('common.listSeparator'));
  }
  const slugs = roleIds.filter((id) => isSystemRoleName(id));
  if (slugs.length > 0) {
    return slugs.map((n) => roleDisplayName(t, n)).join(t('common.listSeparator'));
  }
  if (fallbackName && fallbackName !== 'Assigned' && fallbackName !== 'None') {
    return roleDisplayName(t, fallbackName);
  }
  return t('admin.users.noRole');
}

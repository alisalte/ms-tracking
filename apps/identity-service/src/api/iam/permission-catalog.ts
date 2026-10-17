/**
 * Shared permission catalog and custom-role checks. The operator console and
 * the tenant's own IAM API must accept the same permission strings.
 */
import { ALL_PERMISSIONS, SYSTEM_ROLES, WILDCARD_PERMISSION } from '@fleetvision/auth';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Role } from '../../domain/index.js';

export const DOMAIN_LABEL: Record<string, string> = {
  iam: 'admin.permissions.domain.iam',
  fleet: 'admin.permissions.domain.fleet',
  vehicle: 'admin.permissions.domain.vehicle',
  device: 'admin.permissions.domain.device',
  tracking: 'admin.permissions.domain.tracking',
  maps: 'admin.permissions.domain.maps',
  media: 'admin.permissions.domain.media',
  telemetry: 'admin.permissions.domain.telemetry',
  notification: 'admin.permissions.domain.notification',
  report: 'admin.permissions.domain.analytics',
  audit: 'admin.permissions.domain.audit',
  billing: 'admin.permissions.domain.billing',
};

export function permissionCatalog(): Array<{
  domain: string;
  label_key: string;
  permissions: string[];
}> {
  const groups = new Map<string, string[]>();
  for (const permission of ALL_PERMISSIONS) {
    const domain = permission.split('.')[0] ?? 'other';
    const list = groups.get(domain) ?? [];
    list.push(permission);
    groups.set(domain, list);
  }
  return [...groups.entries()].map(([domain, permissions]) => ({
    domain,
    label_key: DOMAIN_LABEL[domain] ?? `admin.permissions.domain.${domain}`,
    permissions,
  }));
}

export function sanitizeCustomPermissions(raw: readonly string[]): string[] {
  const allowed = new Set<string>(ALL_PERMISSIONS);
  const out: string[] = [];
  for (const permission of raw) {
    if (permission === WILDCARD_PERMISSION) {
      throw new HttpException('Wildcard cannot be granted to custom roles', HttpStatus.BAD_REQUEST);
    }
    if (!allowed.has(permission)) {
      throw new HttpException(`Unknown permission: ${permission}`, HttpStatus.BAD_REQUEST);
    }
    if (!out.includes(permission)) out.push(permission);
  }
  return out;
}

export function roleView(role: Role, memberCount: number) {
  const seed = SYSTEM_ROLES.find((item) => item.name === role.name);
  return {
    id: role.id as string,
    name: role.name,
    description: role.description ?? '',
    is_system: role.isSystem,
    permission_keys: [...role.permissions],
    member_count: memberCount,
    mfa_required: seed?.mfaRequired ?? false,
  };
}

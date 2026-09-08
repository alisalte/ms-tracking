import { beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import {
  permissionLabel,
  roleDisplayDescription,
  roleDisplayName,
  userRoleLabel,
} from '@/lib/admin-labels';

describe('admin-labels', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  it('maps catalog keys to English copy without treating dots as nested paths', () => {
    expect(permissionLabel(i18n.t.bind(i18n), 'iam.user.read')).toBe('View users');
    expect(permissionLabel(i18n.t.bind(i18n), 'notification.read.all')).toBe(
      'View all notifications',
    );
    expect(permissionLabel(i18n.t.bind(i18n), 'unknown.perm')).toBe('unknown.perm');
  });

  it('localizes seeded system roles and hides the English seed description', () => {
    const t = i18n.t.bind(i18n);
    expect(roleDisplayName(t, 'tenant-admin')).toBe('Organization admin');
    expect(roleDisplayName(t, 'Night Driver')).toBe('Night Driver');
    expect(roleDisplayDescription(t, 'viewer', 'System role: viewer')).toBe(
      'Read-only access; cannot create or change records.',
    );
  });

  it('resolves user role ids to localized names', () => {
    const t = i18n.t.bind(i18n);
    expect(userRoleLabel(t, ['role-1'], [{ id: 'role-1', name: 'fleet-admin' }], 'Assigned')).toBe(
      'Fleet admin',
    );
    expect(userRoleLabel(t, [], [], 'Assigned')).toBe('No role');
  });
});

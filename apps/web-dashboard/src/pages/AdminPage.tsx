/**
 * AdminPage — the Admin Panel (`/admin`).
 *
 * Two-column settings shell (UI_UX §5.5): `AdminNav` (left) + the active
 * section content (right). The five keyword sections are functional (users,
 * roles, permissions, settings, audit); the rest of the IA renders an "upcoming"
 * placeholder. The active section + selection sync to the URL (`?section=`).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { usePermissions, useRoles, useUsers } from '@/api/admin.api';
import { AdminNav } from '@/components/admin/AdminNav';
import { AuditSection } from '@/components/admin/AuditSection';
import { PermissionsSection } from '@/components/admin/PermissionsSection';
import { RoleDetailDrawer } from '@/components/admin/RoleDetailDrawer';
import { RolesSection } from '@/components/admin/RolesSection';
import { SettingsSection } from '@/components/admin/SettingsSection';
import { UserDetailDrawer } from '@/components/admin/UserDetailDrawer';
import { UsersSection } from '@/components/admin/UsersSection';
import type { AdminSection, AdminUserStatus } from '@/types/admin.types';
import { Box, Stack, Typography } from '@mui/material';

const ENABLED: AdminSection[] = ['users', 'roles', 'permissions', 'settings', 'audit'];

function readSection(v: string | null): AdminSection {
  return (ENABLED as readonly string[]).includes(v ?? '') ? (v as AdminSection) : 'users';
}

export function AdminPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const section = readSection(params.get('section'));

  // Per-section selection state.
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  // Per-section filter state.
  const [userStatus, setUserStatus] = useState<AdminUserStatus | 'all'>('all');
  const [userQuery, setUserQuery] = useState('');

  const users = useUsers();
  const roles = useRoles();
  const permissions = usePermissions();
  const selectedRole = useMemo(
    () => (roles.data ?? []).find((r) => r.id === selectedRoleId) ?? null,
    [roles.data, selectedRoleId],
  );

  const setSection = (next: AdminSection) => {
    const p = new URLSearchParams(params);
    p.set('section', next);
    setParams(p, { replace: true });
  };

  return (
    <Stack direction="row" sx={{ height: '100%' }}>
      {/* Left nav (UI_UX §5.5) */}
      <Box
        sx={{
          width: 240,
          minWidth: 240,
          borderRight: '1px solid',
          borderColor: 'divider',
          p: 1.5,
          overflowY: 'auto',
        }}
      >
        <Typography variant="overline" color="text.secondary" sx={{ px: 1 }}>
          {t('admin.title')}
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          <AdminNav section={section} onSelect={setSection} />
        </Box>
      </Box>

      {/* Right content */}
      <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {section === 'users' && (
          <>
            <UsersSection
              users={users.data ?? []}
              loading={users.isLoading}
              selectedId={selectedUserId}
              onSelect={setSelectedUserId}
              filterStatus={userStatus}
              query={userQuery}
              onFilterStatus={setUserStatus}
              onQuery={setUserQuery}
            />
            <UserDetailDrawer userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
          </>
        )}
        {section === 'roles' && (
          <>
            <RolesSection
              roles={roles.data ?? []}
              loading={roles.isLoading}
              selectedId={selectedRoleId}
              onSelect={setSelectedRoleId}
            />
            <RoleDetailDrawer role={selectedRole} onClose={() => setSelectedRoleId(null)} />
          </>
        )}
        {section === 'permissions' && <PermissionsSection catalog={permissions.data ?? []} />}
        {section === 'settings' && <SettingsSection />}
        {section === 'audit' && <AuditSection />}
      </Box>
    </Stack>
  );
}

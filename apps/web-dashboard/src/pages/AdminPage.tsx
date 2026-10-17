/**
 * AdminPage — the Admin Panel (`/admin`).
 *
 * Two-column settings shell (UI_UX §5.5): `AdminNav` (left) + the active
 * section content (right); on mobile the nav collapses into a horizontal
 * scrollable strip above the content. Every IA item is wired — live APIs
 * where they exist, honest empty/unavailable cards otherwise. The active
 * section + selection sync to the URL (`?section=`). Failed registry queries
 * surface as per-section ErrorState with retry — never as empty tables.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useRoles, useUsers } from '@/api/admin.api';
import { AdminNav } from '@/components/admin/AdminNav';
import { ApiKeysSection } from '@/components/admin/ApiKeysSection';
import { AuditSection } from '@/components/admin/AuditSection';
import { BillingSection } from '@/components/admin/BillingSection';
import {
  IntegrationsSection,
  NotificationsSection,
  PoliciesSection,
} from '@/components/admin/OpsSections';
import { OrganizationSection } from '@/components/admin/OrganizationSection';
import {
  DevicesSection,
  FleetsSection,
  GeofencesSection,
} from '@/components/admin/RegistrySections';
import { SettingsSection } from '@/components/admin/SettingsSection';
import { UserDetailDrawer } from '@/components/admin/UserDetailDrawer';
import { UsersSection } from '@/components/admin/UsersSection';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/tailwind-ui';
import type { AdminSection, AdminUserStatus } from '@/types/admin.types';

const SECTIONS: AdminSection[] = [
  'organization',
  'users',
  'roles',
  'permissions',
  'fleets',
  'devices',
  'geofences',
  'policies',
  'notifications',
  'integrations',
  'apikeys',
  'billing',
  'audit',
  'settings',
];

function readSection(v: string | null): AdminSection {
  return (SECTIONS as readonly string[]).includes(v ?? '') ? (v as AdminSection) : 'users';
}

export function AdminPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const section = readSection(params.get('section'));

  // Per-section selection state.
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Per-section filter state.
  const [userStatus, setUserStatus] = useState<AdminUserStatus | 'all'>('all');
  const [userQuery, setUserQuery] = useState('');

  const users = useUsers();
  const roles = useRoles();

  const setSection = (next: AdminSection) => {
    const p = new URLSearchParams(params);
    p.set('section', next);
    setParams(p, { replace: true });
  };

  // A failed registry query is a failed section — render the shared error
  // state with retry instead of an empty table that reads as "no data".
  const sectionError = section === 'users' ? users.error : null;
  const sectionRetry = section === 'users' ? () => void users.refetch() : undefined;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow={t('admin.eyebrow')}
        title={t('admin.title')}
        description={t('admin.description')}
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Mobile: horizontal section strip. Desktop: left nav (UI_UX §5.5). */}
        <div className="border-b border-gray-200 px-4 py-2 md:hidden dark:border-white/10">
          <AdminNav section={section} onSelect={setSection} orientation="horizontal" />
        </div>
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-e border-gray-200 p-3 md:block dark:border-white/10">
          <AdminNav section={section} onSelect={setSection} />
        </aside>

        {/* Section content — one gutter owner (this wrapper), not per-section p-2. */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {sectionError ? (
            <ErrorState error={sectionError} onRetry={sectionRetry} />
          ) : (
            <>
              {section === 'organization' && <OrganizationSection />}
              {section === 'users' && (
                <>
                  <UsersSection
                    users={users.data ?? []}
                    roles={roles.data ?? []}
                    loading={users.isLoading}
                    selectedId={selectedUserId}
                    onSelect={setSelectedUserId}
                    filterStatus={userStatus}
                    query={userQuery}
                    onFilterStatus={setUserStatus}
                    onQuery={setUserQuery}
                  />
                  <UserDetailDrawer
                    userId={selectedUserId}
                    roles={roles.data ?? []}
                    onClose={() => setSelectedUserId(null)}
                  />
                </>
              )}
              {(section === 'roles' || section === 'permissions') && (
                <p
                  className="text-sm text-gray-600 dark:text-graydark-600"
                  data-testid="access-managed-elsewhere"
                >
                  {t('admin.roles.managedInTenantAdmin')}
                </p>
              )}
              {section === 'fleets' && <FleetsSection />}
              {section === 'devices' && <DevicesSection />}
              {section === 'geofences' && <GeofencesSection />}
              {section === 'policies' && <PoliciesSection />}
              {section === 'notifications' && <NotificationsSection />}
              {section === 'integrations' && <IntegrationsSection />}
              {section === 'apikeys' && <ApiKeysSection />}
              {section === 'billing' && <BillingSection />}
              {section === 'settings' && <SettingsSection />}
              {section === 'audit' && <AuditSection />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

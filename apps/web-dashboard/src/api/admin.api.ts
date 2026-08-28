/**
 * Administration API + data hooks.
 *
 * **Real backend endpoints** (identity-service — running in Docker):
 * - GET    /iam/users — list users
 * - GET    /iam/users/:id — user detail
 * - POST   /iam/users — create user
 * - PUT    /iam/users/:id — update user (email only; display_name not persisted backend-side)
 * - POST   /iam/users/:id/roles — assign role
 * - PATCH  /iam/users/:id/status — suspend / deactivate / activate
 * - GET    /auth/api-keys — list API keys
 * - POST   /auth/api-keys — create API key
 * - DELETE /auth/api-keys/:id — revoke API key
 * - GET    /iam/roles — list roles
 * - PUT    /iam/roles/:id — update custom role permissions
 * - GET    /iam/permissions — permission catalog
 * - GET    /tenant — tenant self-view
 * - GET    /tenant/settings — tenant settings
 * - PUT    /tenant/settings — update tenant settings
 * - GET    /audit/entries — hash-chained identity audit log
 *
 * Fleets/vehicles/devices/geofences/notifications reuse their own API modules.
 * Billing invoices, SSO, and SCIM have no service in this stack — the UI
 * states that honestly instead of fabricating records.
 *
 * Mock-gated via `withMockFallback` — production builds never call mocks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock, withMockFallback } from '@/lib/mock-gate';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { downloadBlob } from '@/lib/video-stream';
import {
  PERMISSION_CATALOG,
  mockAuditEntries,
  mockRoles,
  mockSettings,
  mockUsers,
} from '@/mock/admin-data';
import type {
  AdminApiKey,
  AdminUser,
  AdminUserStatus,
  AuditAction,
  AuditCategory,
  PermissionGroup,
  Role,
  TenantInfo,
  TenantSettings,
} from '@/types/admin.types';
import { apiDeleteNoContent, apiGet, apiPatch, apiPost, apiPostNoContent, apiPut } from './client';
import { queryKeys } from './query-keys';

// ── identity-service wire format → UI type ───────────────────────────────────

interface UserWire {
  id: string;
  tenant_id: string;
  email: string;
  username: string;
  status: string;
  display_name: string | null;
  roles: string[];
  mfa_enabled: boolean;
  last_login_at: string | null;
}

function mapUser(wire: UserWire): AdminUser {
  const status = wire.status.toLowerCase() as AdminUserStatus;
  return {
    id: wire.id,
    email: wire.email,
    username: wire.username,
    firstName: wire.display_name?.split(' ')[0] ?? wire.username,
    lastName: wire.display_name?.split(' ').slice(1).join(' ') ?? '',
    status,
    roleIds: wire.roles,
    roleName: wire.roles.length > 0 ? 'Assigned' : 'None',
    mfaEnabled: wire.mfa_enabled,
    lastLoginAt: wire.last_login_at ?? undefined,
    authProvider: 'local',
    createdAt: new Date().toISOString(),
  };
}

interface RoleWire {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  permission_keys: string[];
  member_count: number;
  mfa_required: boolean;
}

function mapRole(wire: RoleWire): Role {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
    isSystem: wire.is_system,
    permissionKeys: wire.permission_keys ?? [],
    memberCount: wire.member_count ?? 0,
    mfaRequired: wire.mfa_required ?? false,
  };
}

interface PermissionGroupWire {
  domain: string;
  label_key: string;
  permissions: string[];
}

function mapPermissionGroup(wire: PermissionGroupWire): PermissionGroup {
  return {
    domain: wire.domain,
    labelKey: wire.label_key,
    permissions: wire.permissions,
  };
}

interface TenantWire {
  id: string;
  name: string;
  tier: string;
  region: string;
  status: string;
}

function mapTenant(wire: TenantWire): TenantInfo {
  return {
    id: wire.id,
    name: wire.name,
    tier: wire.tier,
    region: wire.region,
    status: wire.status,
  };
}

interface ApiKeyWire {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
}

function mapApiKey(wire: ApiKeyWire): AdminApiKey {
  return {
    id: wire.id,
    name: wire.name,
    keyPrefix: wire.key_prefix,
    scopes: wire.scopes ?? [],
    status: wire.status,
    expiresAt: wire.expires_at,
    lastUsedAt: wire.last_used_at,
  };
}

interface AuditWire {
  id: string;
  created_at: string;
  action: string;
  actor_type: string;
  actor_id: string | null;
  resource_type: string;
  resource_id: string | null;
  request_id: string | null;
  ip_address: string | null;
  outcome: string;
  entry_hash: string;
}

const AUDIT_ACTIONS: AuditAction[] = [
  'create',
  'update',
  'delete',
  'read',
  'execute',
  'login',
  'logout',
  'authorize',
  'deny',
  'export',
  'import',
  'config_change',
  'system',
];

function mapAuditAction(raw: string): AuditAction {
  const key = raw.trim().toLowerCase().replace(/-/g, '_') as AuditAction;
  return AUDIT_ACTIONS.includes(key) ? key : 'system';
}

function mapAuditCategory(resourceType: string): AuditCategory {
  const r = resourceType.toLowerCase();
  if (r.includes('user') || r.includes('auth') || r.includes('session')) return 'authentication';
  if (r.includes('role') || r.includes('permission') || r.includes('api_key'))
    return 'authorization';
  if (r.includes('tenant')) return 'tenant';
  return 'system';
}

function mapAudit(wire: AuditWire): import('@/types/admin.types').AuditEntry {
  const actorType = wire.actor_type.toLowerCase();
  return {
    id: wire.id,
    timestamp: wire.created_at,
    action: mapAuditAction(wire.action),
    category: mapAuditCategory(wire.resource_type),
    actorName: wire.actor_id ?? wire.actor_type,
    actorType:
      actorType === 'user' || actorType === 'service' || actorType === 'system'
        ? actorType
        : 'system',
    targetType: wire.resource_type,
    targetId: wire.resource_id ?? '',
    sourceService: 'identity-service',
    ipAddress: wire.ip_address ?? undefined,
    correlationId: wire.request_id ?? '',
    integrityHash: wire.entry_hash,
  };
}

// ── Fetchers (real backend with mock fallback) ───────────────────────────────

/** GET /iam/users — real identity-service; mock fallback in dev. */
async function fetchUsers(): Promise<AdminUser[]> {
  return withMockFallback(
    async () => {
      // Identity responds { data: rows, meta: { total } } on the wire; the
      // envelope-unwrapping apiGet yields the rows array directly.
      const rows = await apiGet<UserWire[]>('/iam/users', { limit: 100 });
      return rows.map(mapUser);
    },
    () => resolveMock(mockUsers),
  );
}

/** GET /iam/users/:id — real identity-service; mock fallback in dev. */
async function fetchUserDetail(id: string): Promise<AdminUser | undefined> {
  return withMockFallback(
    async () => {
      const wire = await apiGet<UserWire | null>(`/iam/users/${id}`);
      return wire ? mapUser(wire) : undefined;
    },
    () => resolveMock(mockUsers.find((u) => u.id === id)),
  );
}

/** GET /iam/roles — identity-service. */
async function fetchRoles(): Promise<Role[]> {
  return withMockFallback(
    async () => {
      const rows = await apiGet<RoleWire[]>('/iam/roles');
      return (Array.isArray(rows) ? rows : []).map(mapRole);
    },
    () => resolveMock(mockRoles),
  );
}

/** GET /iam/permissions — canonical catalog grouped by domain. */
async function fetchPermissions(): Promise<PermissionGroup[]> {
  return withMockFallback(
    async () => {
      const rows = await apiGet<PermissionGroupWire[]>('/iam/permissions');
      return (Array.isArray(rows) ? rows : []).map(mapPermissionGroup);
    },
    () => resolveMock(PERMISSION_CATALOG),
  );
}

/** GET /tenant/settings — identity-service. */
async function fetchSettings(): Promise<TenantSettings> {
  return withMockFallback(
    async () => apiGet<TenantSettings>('/tenant/settings'),
    () => resolveMock(mockSettings),
  );
}

/** GET /tenant — identity-service self-view. */
async function fetchTenant(): Promise<TenantInfo | null> {
  return withMockFallback(
    async () => {
      const wire = await apiGet<TenantWire | null>('/tenant');
      return wire ? mapTenant(wire) : null;
    },
    async () => ({
      id: 'mock-tenant',
      name: mockSettings.orgName,
      tier: 'STANDARD',
      region: 'local',
      status: 'ACTIVE',
    }),
  );
}

/** GET /auth/api-keys — identity-service. */
async function fetchApiKeys(): Promise<AdminApiKey[]> {
  return withMockFallback(
    async () => {
      const rows = await apiGet<ApiKeyWire[]>('/auth/api-keys');
      return (Array.isArray(rows) ? rows : []).map(mapApiKey);
    },
    async () => [],
  );
}

/** GET /audit/entries — identity-service hash-chained log. */
async function fetchAudit(): Promise<import('@/types/admin.types').AuditEntry[]> {
  return withMockFallback(
    async () => {
      const rows = await apiGet<AuditWire[]>('/audit/entries', { limit: 200 });
      return (Array.isArray(rows) ? rows : []).map(mapAudit);
    },
    () => resolveMock(mockAuditEntries),
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useUsers() {
  return useQuery({ queryKey: queryKeys.admin.users(), queryFn: fetchUsers });
}

/**
 * Users list via useCursorPagination (real backend: GET /iam/users?limit=).
 * Identity currently pages with a fixed limit/offset (no cursor yet), so the
 * first page is mapped with nextCursor=null until the backend ships cursors.
 * Falls back to mock on network error in mock mode.
 */
export function useUsersPage() {
  return useCursorPagination<AdminUser>(queryKeys.admin.users(), (cursor) =>
    withMockFallback(
      async () => {
        const rows = await apiGet<UserWire[]>(
          '/iam/users',
          cursor ? { limit: 25, cursor } : { limit: 25 },
        );
        return { data: rows.map(mapUser), nextCursor: null };
      },
      async () => ({ data: mockUsers, nextCursor: null }),
    ),
  );
}
export function useUserDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.admin.userDetail(id) : ['admin', 'user', 'none'],
    queryFn: () => fetchUserDetail(id as string),
    enabled: Boolean(id),
  });
}
export function useRoles() {
  return useQuery({ queryKey: queryKeys.admin.roles(), queryFn: fetchRoles });
}
export function usePermissions() {
  return useQuery({ queryKey: queryKeys.admin.permissions(), queryFn: fetchPermissions });
}
export function useSettings() {
  return useQuery({ queryKey: queryKeys.admin.settings(), queryFn: fetchSettings });
}
export function useAuditEntries() {
  return useQuery({ queryKey: queryKeys.admin.audit(), queryFn: fetchAudit });
}
export function useTenant() {
  return useQuery({ queryKey: queryKeys.admin.tenant(), queryFn: fetchTenant });
}
export function useApiKeys() {
  return useQuery({ queryKey: queryKeys.admin.apiKeys(), queryFn: fetchApiKeys });
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create user → `POST /iam/users` (identity-service).
 *
 * Real backend call. In dev without the server running, falls back to mock.
 */
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation<
    AdminUser,
    Error,
    { email: string; username: string; password: string; displayName?: string }
  >({
    mutationFn: async (input) => {
      return withMockFallback(
        async () => {
          const wire = await apiPost<unknown, UserWire>('/iam/users', {
            email: input.email,
            username: input.username,
            password: input.password,
            display_name: input.displayName,
          });
          return mapUser(wire);
        },
        () => resolveMock({ ...mockUsers[0], ...input } as AdminUser),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.users() }),
  });
}

/**
 * Update user → `PUT /iam/users/:id` (identity-service).
 * Note: backend currently only persists email changes, not display_name.
 */
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation<AdminUser, Error, { id: string; email?: string; displayName?: string }>({
    mutationFn: async ({ id, email, displayName }) => {
      return withMockFallback(
        async () => {
          const wire = await apiPut<unknown, UserWire>(`/iam/users/${id}`, {
            email,
            display_name: displayName,
          });
          return mapUser(wire);
        },
        () => resolveMock({ ...mockUsers[0], email: email ?? mockUsers[0]?.email } as AdminUser),
      );
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.userDetail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
  });
}

/**
 * Assign role → `POST /iam/users/:id/roles` (identity-service, HTTP 204).
 */
export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation<void, Error, { userId: string; roleId: string }>({
    mutationFn: async ({ userId, roleId }) => {
      await withMockFallback(
        () => apiPostNoContent(`/iam/users/${userId}/roles`, { role_id: roleId }),
        () => resolveMock(undefined),
      );
    },
    onSuccess: (_d, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.userDetail(userId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
  });
}

/**
 * User status action → `PATCH /iam/users/:id/status`.
 */
export function useUserStatusAction() {
  const qc = useQueryClient();
  return useMutation<
    AdminUser,
    Error,
    { id: string; status: AdminUserStatus },
    { prev: AdminUser[] | undefined }
  >({
    mutationFn: async ({ id, status }) => {
      return withMockFallback(
        async () => {
          const wire = await apiPatch<{ status: AdminUserStatus }, UserWire>(
            `/iam/users/${id}/status`,
            { status },
          );
          return mapUser(wire);
        },
        async () => {
          const cached = qc.getQueryData<AdminUser[]>(queryKeys.admin.users());
          const base = cached?.find((u) => u.id === id);
          if (!base) throw new Error(`user ${id} not found`);
          return resolveMock({ ...base, status });
        },
      );
    },
    onMutate: async ({ id, status }) => {
      const listKey = queryKeys.admin.users();
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<AdminUser[]>(listKey);
      qc.setQueryData<AdminUser[]>(listKey, (old) =>
        (old ?? []).map((u) => (u.id === id ? { ...u, status } : u)),
      );
      qc.setQueryData<AdminUser | undefined>(queryKeys.admin.userDetail(id), (old) =>
        old ? { ...old, status } : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.admin.users(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.admin.all }),
  });
}

/**
 * Update tenant settings → `PUT /tenant/settings` (identity-service).
 */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation<
    TenantSettings,
    Error,
    Partial<TenantSettings>,
    { prev: TenantSettings | undefined }
  >({
    mutationFn: async (patch) => {
      return withMockFallback(
        async () => apiPut<Partial<TenantSettings>, TenantSettings>('/tenant/settings', patch),
        () => resolveMock({ ...mockSettings, ...patch } satisfies TenantSettings),
      );
    },
    onMutate: async (patch) => {
      const key = queryKeys.admin.settings();
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TenantSettings>(key);
      qc.setQueryData<TenantSettings>(key, (old) => ({ ...(old ?? mockSettings), ...patch }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.admin.settings(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.admin.all }),
  });
}

/**
 * Create a custom role → `POST /iam/roles` (identity-service).
 * System roles cannot be created this way; wildcard `*` is rejected by the API.
 */
export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation<Role, Error, { name: string; description?: string }>({
    mutationFn: async (input) => {
      return withMockFallback(
        async () => {
          const wire = await apiPost<
            { name: string; description?: string; permissions: string[] },
            RoleWire
          >('/iam/roles', { name: input.name, description: input.description, permissions: [] });
          return mapRole(wire);
        },
        () =>
          resolveMock({
            id: `custom-${Date.now()}`,
            name: input.name,
            description: input.description ?? '',
            isSystem: false,
            permissionKeys: [],
            memberCount: 0,
            mfaRequired: false,
          } satisfies Role),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.roles() }),
  });
}

/**
 * Replace a custom role's permission set → `PUT /iam/roles/:id`.
 */
export function useUpdateRolePermissions() {
  const qc = useQueryClient();
  return useMutation<Role, Error, { id: string; permissions: string[] }>({
    mutationFn: async ({ id, permissions }) => {
      return withMockFallback(
        async () => {
          const wire = await apiPut<{ permissions: string[] }, RoleWire>(`/iam/roles/${id}`, {
            permissions,
          });
          return mapRole(wire);
        },
        () => {
          const base = mockRoles.find((r) => r.id === id) ?? mockRoles[0];
          return resolveMock({ ...base, permissionKeys: permissions } as Role);
        },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.roles() }),
  });
}

/**
 * Export audit entries → `POST /audit/export` (Audit §5.1).
 * Mock: builds a CSV from entries and downloads.
 */
export function useExportAudit() {
  return useMutation<Blob, Error, { entries: import('@/types/admin.types').AuditEntry[] }>({
    mutationFn: async ({ entries }) => {
      const header = 'timestamp,action,category,actor,target,service,correlationId,hash';
      const rows = entries.map(
        (e) =>
          `${e.timestamp},${e.action},${e.category},${e.actorName},${e.targetType}:${e.targetId},${e.sourceService},${e.correlationId},${e.integrityHash}`,
      );
      return new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    },
    onSuccess: (blob) => downloadBlob(blob, `audit-export-${Date.now()}.csv`),
  });
}

/**
 * Create an API key → `POST /auth/api-keys`. The plaintext is returned once.
 */
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation<
    { id: string; key: string; keyPrefix: string },
    Error,
    { name: string; scopes: string[] }
  >({
    mutationFn: async (input) => {
      return withMockFallback(
        async () => {
          const wire = await apiPost<unknown, { id: string; key: string; key_prefix: string }>(
            '/auth/api-keys',
            { name: input.name, scopes: input.scopes },
          );
          return { id: wire.id, key: wire.key, keyPrefix: wire.key_prefix };
        },
        async () => ({
          id: `mock-${Date.now()}`,
          key: 'fv_live_mock-plaintext-once',
          keyPrefix: 'fv_live_mock',
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.apiKeys() }),
  });
}

/**
 * Revoke an API key → `DELETE /auth/api-keys/:id`.
 */
export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await withMockFallback(
        () => apiDeleteNoContent(`/auth/api-keys/${id}`),
        () => resolveMock(undefined),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.apiKeys() }),
  });
}

/** Re-export types. */
export type { AuditAction, AuditCategory };

/**
 * Administration API + data hooks.
 *
 * **Real backend endpoints** (identity-service — running in Docker):
 * - GET    /iam/users — list users
 * - GET    /iam/users/:id — user detail
 * - POST   /iam/users — create user
 * - PUT    /iam/users/:id — update user (email only; display_name not persisted backend-side)
 * - POST   /iam/users/:id/roles — assign role
 * - GET    /auth/api-keys — list API keys
 * - POST   /auth/api-keys — create API key
 * - DELETE /auth/api-keys/:id — revoke API key
 * - GET    /tenant — self-view tenant info
 *
 * **Mock-only** (no backend exists yet):
 * - Roles, permissions catalog, settings, audit entries
 *
 * Mock-gated via `withMockFallback` — production builds never call mocks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { NotImplementedError } from '@/lib/errors';
import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
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
  AdminUser,
  AdminUserStatus,
  AuditAction,
  AuditCategory,
  PermissionGroup,
  Role,
  TenantSettings,
} from '@/types/admin.types';
import { apiGet, apiPost, apiPostNoContent, apiPut } from './client';
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

/** GET /iam/roles — no backend; mock-only (gated). */
async function fetchRoles(): Promise<Role[]> {
  if (!shouldUseMock()) return [];
  return resolveMock(mockRoles);
}

/** The permission catalog — static (02_Domain_Model §6.1). */
async function fetchPermissions(): Promise<PermissionGroup[]> {
  if (!shouldUseMock()) return PERMISSION_CATALOG;
  return resolveMock(PERMISSION_CATALOG);
}

/** GET /settings — no backend; mock-only (gated). */
async function fetchSettings(): Promise<TenantSettings> {
  // No settings backend exists yet — real mode must fail honestly (§22) so the
  // Settings section shows its error state instead of fabricated settings.
  if (!shouldUseMock()) {
    throw new NotImplementedError('Tenant settings API is not implemented yet');
  }
  return resolveMock(mockSettings);
}

/** GET /audit/entries — no backend; mock-only (gated). */
async function fetchAudit(): Promise<import('@/types/admin.types').AuditEntry[]> {
  if (!shouldUseMock()) return [];
  return resolveMock(mockAuditEntries);
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
 * Backend has no PATCH /status yet — mock optimistic update only. In REAL mode
 * the mutation REJECTS honestly instead of fabricating a persisted change.
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
      if (!shouldUseMock()) {
        throw new Error('User status changes are not available (backend not implemented).');
      }
      const cached = qc.getQueryData<AdminUser[]>(queryKeys.admin.users());
      const base = cached?.find((u) => u.id === id);
      if (!base) throw new Error(`user ${id} not found`);
      return resolveMock({ ...base, status });
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
 * Update tenant settings → `PUT /settings`.
 * No backend yet — mock optimistic update. In REAL mode the mutation REJECTS
 * honestly instead of fabricating a persisted "Saved".
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
      if (!shouldUseMock()) {
        throw new Error('Settings changes are not available (settings backend not implemented).');
      }
      return resolveMock({ ...mockSettings, ...patch } satisfies TenantSettings);
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

/** Re-export types. */
export type { AuditAction, AuditCategory };

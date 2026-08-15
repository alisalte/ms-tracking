import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSION_CATALOG, mockAuditEntries, mockRoles, mockUsers } from '@/mock/admin-data';
import { AdminPage } from '@/pages/AdminPage';

import { i18n } from '@/i18n';

// ── Mock the API client so fetchUsers returns the mock user list (no live
// identity-service in the test env). The users endpoint is now real; the rest
// stays mock via resolveMock.
vi.mock('@/api/client', () => ({
  // NOTE: these mocks mimic the REAL client's post-interceptor semantics —
  // apiGet returns the UNWRAPPED payload (the { data } envelope is stripped),
  // so the list branch returns the rows array directly, not the wire body.
  apiGet: vi.fn(async (url: string) => {
    if (url === '/iam/users') {
      // List endpoint — the real wire body is { data: rows, meta }, which the
      // client unwraps to the rows array.
      return mockUsers.map((u) => ({
        id: u.id,
        tenant_id: 'test-tenant',
        email: u.email,
        username: u.username,
        status: u.status.toUpperCase(),
        display_name: `${u.firstName} ${u.lastName}`,
        roles: u.roleIds,
        mfa_enabled: u.mfaEnabled,
        last_login_at: u.lastLoginAt ?? null,
      }));
    }
    if (url.startsWith('/iam/users/')) {
      // Detail endpoint — find the user by id; the client unwraps { data }.
      const id = url.split('/').pop();
      const u = mockUsers.find((m) => m.id === id);
      return u
        ? {
            id: u.id,
            tenant_id: 'test-tenant',
            email: u.email,
            username: u.username,
            status: u.status.toUpperCase(),
            display_name: `${u.firstName} ${u.lastName}`,
            roles: u.roleIds,
            mfa_enabled: u.mfaEnabled,
            last_login_at: u.lastLoginAt ?? null,
          }
        : null;
    }
    return null;
  }),
  apiClient: { interceptors: { request: { use: () => {} }, response: { use: () => {} } } },
  apiGetRaw: vi.fn(async () => []),
  apiPost: vi.fn(),
  apiPostNoContent: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(async () => undefined),
  apiDeleteNoContent: vi.fn(async () => undefined),
}));

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderAdmin(initialEntry = '/admin?section=users') {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, { initialEntries: [initialEntry] }, createElement(AdminPage)),
      ),
    ),
  );
}

describe('AdminPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the left nav with the admin title', async () => {
    renderAdmin();
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    // A functional nav item label.
    expect(screen.getByText('Users & Roles')).toBeInTheDocument();
  });

  it('renders user rows on the Users section', async () => {
    renderAdmin();
    const first = mockUsers[0];
    await waitFor(() => {
      expect(screen.getByText(first.email)).toBeInTheDocument();
    });
  });

  it('opens the user detail drawer when a row is clicked', async () => {
    renderAdmin();
    const first = mockUsers[0];
    await waitFor(() => expect(screen.getByText(first.email)).toBeInTheDocument());

    fireEvent.click(screen.getByText(first.email));
    await waitFor(() => {
      expect(screen.getByText('Username')).toBeInTheDocument();
    });
  });

  it('switches to the Roles section and renders system + custom roles', async () => {
    renderAdmin('/admin?section=roles');
    await waitFor(() => {
      expect(screen.getByText(mockRoles[0].name)).toBeInTheDocument();
    });
  });

  it('opens the role detail drawer with the permission matrix', async () => {
    renderAdmin('/admin?section=roles');
    const role = mockRoles.find((r) => r.isSystem);
    await waitFor(() => expect(role && screen.getByText(role.name)).toBeTruthy());
    if (role) fireEvent.click(screen.getByText(role.name));

    await waitFor(() => {
      expect(screen.getByText('Permission matrix')).toBeInTheDocument();
    });
  });

  it('renders the permission catalog on the Permissions section', async () => {
    renderAdmin('/admin?section=permissions');
    await waitFor(() => {
      expect(screen.getByText('Identity & Access')).toBeInTheDocument();
    });
  });

  it('renders the settings form on the Settings section', async () => {
    renderAdmin('/admin?section=settings');
    await waitFor(() => {
      expect(screen.getByText('Organization name')).toBeInTheDocument();
    });
  });

  it('renders the audit log on the Audit section', async () => {
    renderAdmin('/admin?section=audit');
    // Wait for audit rows to render (the source service appears in rows once
    // the query resolves; it repeats across rows so use getAllByText).
    await waitFor(() => {
      expect(screen.getAllByText(mockAuditEntries[0].sourceService).length).toBeGreaterThan(0);
    });
    // The header renders too.
    expect(screen.getByText('Integrity hash')).toBeInTheDocument();
  });

  it('uses mock data covering the canonical catalog domains', () => {
    expect(PERMISSION_CATALOG.length).toBeGreaterThanOrEqual(14);
    const domains = new Set(PERMISSION_CATALOG.map((g) => g.domain));
    expect(domains.has('iam')).toBe(true);
    expect(domains.has('fleet')).toBe(true);
  });

  it('includes the 9 system roles', () => {
    const system = mockRoles.filter((r) => r.isSystem);
    expect(system.length).toBe(9);
  });
});

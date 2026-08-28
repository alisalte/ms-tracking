/**
 * Phase 3 — Authentication, tenant context & RBAC integration tests.
 *
 * Covers: the TailAdmin login page (validation, success redirect, failure
 * alert), token refresh (success persists / failure clears session), protected
 * routes (redirect + restore), route permission gates incl. the 403 state and
 * ANY-of semantics, the centralized current-user hook (user/tenant/roles/
 * permissions), ErrorState classification (401/403/network), and nav filtering
 * parity with route gating. The auth API layer is mocked — no backend.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProtectedRoute } from '@/auth/auth.guard';
import { useAuthStore } from '@/auth/auth.store';
import { useCurrentUser } from '@/auth/useCurrentUser';
import { ErrorState } from '@/components/common/ErrorState';
import { RequirePermission } from '@/components/common/RequirePermission';
import { i18n } from '@/i18n';
import { LoginPage } from '@/pages/LoginPage';

// ── Auth API mocks ──────────────────────────────────────────────────────────

const loginApi = vi.hoisted(() => ({
  login: vi.fn(),
  getMe: vi.fn(),
  refreshToken: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/auth.api', () => loginApi);

// Single-flight token rotation mock — the store refresh path goes through it.
const tokenRefresh = vi.hoisted(() => {
  const subscribers: Array<(tokens: unknown) => void> = [];
  return {
    __subscribers: subscribers,
    refreshTokensSingleFlight: vi.fn(),
    subscribeTokensRefreshed: vi.fn((cb: (tokens: unknown) => void) => {
      subscribers.push(cb);
      return () => {
        const i = subscribers.indexOf(cb);
        if (i >= 0) subscribers.splice(i, 1);
      };
    }),
  };
});

const tokenRefreshSubscribers = tokenRefresh.__subscribers;

vi.mock('@/api/token-refresh', () => tokenRefresh);

const LOGIN_OK = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: { id: 'u1', email: 'op@fleet.test', tenantId: 'tenant-uuid-1', roles: ['operator'] },
};

const FULL_USER = {
  id: 'u1',
  email: 'op@fleet.test',
  tenantId: 'tenant-uuid-1',
  roles: ['operator'],
  permissions: ['tracking.read', 'fleet.read'],
};

function resetStore() {
  localStorage.removeItem('fleetvision_tokens');
  localStorage.removeItem('fleetvision_tenant_id');
  useAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    user: null,
    tenantId: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
  });
}

function signInAs(permissions: readonly string[]) {
  useAuthStore.setState({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    isAuthenticated: true,
    isLoading: false,
    error: null,
    tenantId: 'tenant-uuid-1',
    user: { ...FULL_USER, permissions },
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  loginApi.logout.mockResolvedValue(undefined);
});

// ── Login page ──────────────────────────────────────────────────────────────

function renderLoginAt(path = '/login') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div data-testid="page">dashboard</div>} />
          <Route path="/map" element={<div data-testid="page">map</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('LoginPage — TailAdmin sign-in', () => {
  it('renders tenant/email/password fields with labels', () => {
    renderLoginAt();
    expect(screen.getByLabelText('Organization')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
  });

  it('prefills the local seed admin so docker compose sign-in works without guessing', () => {
    renderLoginAt();
    expect((screen.getByLabelText('Organization') as HTMLInputElement).value).toBe('FleetVision');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(
      'admin@fleetvision.local',
    );
  });

  it('blocks submit and shows zod validation errors when empty', async () => {
    renderLoginAt();
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => {
      // All three required-field messages surface under the inputs.
      expect(screen.getAllByText(/required/i).length).toBeGreaterThanOrEqual(3);
    });
    expect(loginApi.login).not.toHaveBeenCalled();
  });

  it('logs in via the auth store and redirects to ?redirect target', async () => {
    loginApi.login.mockResolvedValue(LOGIN_OK);
    loginApi.getMe.mockResolvedValue(FULL_USER);
    renderLoginAt('/login?redirect=/map');

    fireEvent.change(screen.getByLabelText('Organization'), {
      target: { value: 'FleetVision' },
    });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'op@fleet.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('map'));
    expect(loginApi.login).toHaveBeenCalledWith('op@fleet.test', 'Secret123!', 'FleetVision');
    // Session persisted + canonical tenant resolved from the response.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().tenantId).toBe('tenant-uuid-1');
    expect(localStorage.getItem('fleetvision_tokens')).toContain('access-1');
  });

  it('shows a danger alert and stays on the page when credentials fail', async () => {
    loginApi.login.mockRejectedValue(new Error('Invalid credentials'));
    renderLoginAt();

    fireEvent.change(screen.getByLabelText('Organization'), {
      target: { value: 'FleetVision' },
    });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'op@fleet.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid'));
    expect(screen.queryByTestId('page')).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

// ── Session handling ────────────────────────────────────────────────────────

describe('session — refresh, restore, logout', () => {
  it('refreshTokens() persists the new pair', async () => {
    signInAs(['tracking.read']);
    // Emulate the real single-flight module: persist + notify (the store syncs
    // through the subscription, not the return value).
    tokenRefresh.refreshTokensSingleFlight.mockImplementation(async () => {
      const tokens = {
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        tenantId: 'tenant-uuid-1',
      };
      const { saveTokens } = await import('@/auth/token.storage');
      saveTokens(tokens);
      for (const cb of tokenRefreshSubscribers) cb(tokens);
      return tokens;
    });
    await useAuthStore.getState().refreshTokens();
    expect(useAuthStore.getState().accessToken).toBe('access-2');
    expect(localStorage.getItem('fleetvision_tokens')).toContain('access-2');
  });

  it('refreshTokens() failure clears the whole session', async () => {
    signInAs(['tracking.read']);
    tokenRefresh.refreshTokensSingleFlight.mockImplementation(async () => {
      const { clearTokens } = await import('@/auth/token.storage');
      clearTokens();
      for (const cb of tokenRefreshSubscribers) cb(null);
      return null;
    });
    await useAuthStore.getState().refreshTokens();
    const s = useAuthStore.getState();
    expect(s.accessToken).toBeNull();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(localStorage.getItem('fleetvision_tokens')).toBeNull();
  });

  it('logout() revokes server-side and clears local state + storage', async () => {
    signInAs(['tracking.read']);
    await useAuthStore.getState().logout();
    expect(loginApi.logout).toHaveBeenCalledOnce();
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.accessToken).toBeNull();
    expect(localStorage.getItem('fleetvision_tokens')).toBeNull();
  });

  it('ProtectedRoute redirects unauthenticated users to /login with redirect param', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/login" element={<div data-testid="page">login</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<div data-testid="page">dashboard</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByTestId('page').textContent).toBe('login');
    // location.search carries the original path for post-login restore.
    expect(window.location.search).toBe('');
  });

  it('ProtectedRoute renders children for a restored (hydrated) session', () => {
    signInAs([]);
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/login" element={<div data-testid="page">login</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<div data-testid="page">dashboard</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByTestId('page').textContent).toBe('dashboard');
  });
});

// ── RBAC ────────────────────────────────────────────────────────────────────

function renderGated(
  permissions: readonly string[],
  props: { permission?: string; anyOf?: readonly string[] },
) {
  signInAs(permissions);
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <RequirePermission {...props}>
          <div data-testid="guarded">secret-area</div>
        </RequirePermission>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('RequirePermission — route gates and the 403 state', () => {
  it('renders children when the exact permission is granted', () => {
    renderGated(['tracking.read'], { permission: 'tracking.read' });
    expect(screen.getByTestId('guarded').textContent).toBe('secret-area');
  });

  it('renders the 403 Permission Denied state when the permission is missing', () => {
    renderGated(['fleet.read'], { permission: 'tracking.read' });
    expect(screen.queryByTestId('guarded')).toBeNull();
    expect(screen.getByText('Permission denied')).toBeTruthy();
    expect(screen.getByText('You do not have access to this area.')).toBeTruthy();
  });

  it("the '*' wildcard satisfies any requirement (tenant admin)", () => {
    renderGated(['*'], { permission: 'tracking.read' });
    expect(screen.getByTestId('guarded')).toBeTruthy();
  });

  it('anyOf unlocks when at least ONE permission is granted (assets parity)', () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <RequirePermission anyOf={['vehicle.read', 'fleet.read']}>
            <div data-testid="guarded">assets</div>
          </RequirePermission>
        </MemoryRouter>
      </I18nextProvider>,
    );
    signInAs(['fleet.read']); // fleet-only operator — nav shows Assets, route must too
    rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <RequirePermission anyOf={['vehicle.read', 'fleet.read']}>
            <div data-testid="guarded">assets</div>
          </RequirePermission>
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByTestId('guarded')).toBeTruthy();
  });
});

// ── Current user / tenant context ───────────────────────────────────────────

describe('useCurrentUser — centralized principal', () => {
  it('exposes user, tenant, roles, and permissions in one hook', () => {
    signInAs(['tracking.read']);
    const result: { current?: ReturnType<typeof useCurrentUser> } = {};
    function Probe() {
      result.current = useCurrentUser();
      return null;
    }
    render(
      <I18nextProvider i18n={i18n}>
        <Probe />
      </I18nextProvider>,
    );
    const c = result.current;
    expect(c?.user?.email).toBe('op@fleet.test');
    expect(c?.tenantId).toBe('tenant-uuid-1');
    expect(c?.roles).toEqual(['operator']);
    expect(c?.permissions).toEqual(['tracking.read']);
    expect(c?.can('tracking.read')).toBe(true);
    expect(c?.can('vehicle.write')).toBe(false);
    expect(c?.permissionsPending).toBe(false);
  });

  it('flags permissionsPending while authenticated but profile not yet loaded', () => {
    useAuthStore.setState({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      isAuthenticated: true,
      user: null,
    });
    let pending = false;
    function Probe() {
      pending = useCurrentUser().permissionsPending;
      return null;
    }
    render(
      <I18nextProvider i18n={i18n}>
        <Probe />
      </I18nextProvider>,
    );
    expect(pending).toBe(true);
  });
});

// ── Error states ────────────────────────────────────────────────────────────

describe('ErrorState — 401 / 403 / network classification', () => {
  function renderWith(error: unknown) {
    return render(
      <I18nextProvider i18n={i18n}>
        <ErrorState error={error} onRetry={() => {}} />
      </I18nextProvider>,
    );
  }

  it('classifies 401 as session expired', () => {
    renderWith(Object.assign(new Error('401'), { status: 401 }));
    expect(screen.getByText('Session expired')).toBeTruthy();
  });

  it('classifies 403 as access denied', () => {
    renderWith(Object.assign(new Error('403'), { status: 403 }));
    expect(screen.getByText('Access denied')).toBeTruthy();
  });

  it('classifies network failures', () => {
    renderWith(Object.assign(new Error('Network Error'), { status: 0, name: 'NetworkError' }));
    expect(screen.getByText('Connection error')).toBeTruthy();
  });

  it('falls back to the generic state and offers retry', () => {
    renderWith(new Error('boom'));
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

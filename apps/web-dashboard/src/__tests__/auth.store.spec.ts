import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import type { LoginResponse, User } from '@/types/auth.types';

// Mock the auth API layer so store actions never hit the network.
vi.mock('@/api/auth.api', () => ({
  login: vi.fn(),
  refreshToken: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
}));

// Importing after the mock is registered so the store picks up the mocks.
const loginApi = await import('@/api/auth.api');

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

/** A camelCase login response as the (mocked) API layer would return it. */
const loginResponse: LoginResponse = {
  accessToken: 'access-123',
  refreshToken: 'refresh-456',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: {
    id: 'user-1',
    email: 'test@fleetvision.io',
    tenantId: 'tenant-789',
    roles: ['admin'],
  },
};

const fullUser: User = {
  id: 'user-1',
  email: 'test@fleetvision.io',
  tenantId: 'tenant-789',
  roles: ['admin'],
  permissions: ['iam.user.read'],
};

describe('auth.store', () => {
  beforeEach(() => {
    // Reset the store between tests
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      user: null,
      tenantId: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    localStorageMock.clear();
    vi.mocked(loginApi.login).mockReset();
    vi.mocked(loginApi.refreshToken).mockReset();
    vi.mocked(loginApi.getMe).mockReset();
    vi.mocked(loginApi.logout).mockReset();
    vi.mocked(loginApi.logoutAll).mockReset();
  });

  it('starts with unauthenticated state', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
  });

  it('hydrate sets tokens and authenticated state', () => {
    useAuthStore.getState().hydrate('access-123', 'refresh-456', 'tenant-789');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-123');
    expect(state.refreshToken).toBe('refresh-456');
    expect(state.tenantId).toBe('tenant-789');
    expect(state.isAuthenticated).toBe(true);
  });

  it('hydrate with null clears auth state', () => {
    // First hydrate with tokens
    useAuthStore.getState().hydrate('access-123', 'refresh-456', 'tenant-789');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    // Then hydrate with null
    useAuthStore.getState().hydrate(null, null, null);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('clearError resets error to null', () => {
    useAuthStore.setState({ error: 'Some error' });
    expect(useAuthStore.getState().error).toBe('Some error');

    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('login resolves true and populates camelCase user/tenantId from the response', async () => {
    vi.mocked(loginApi.login).mockResolvedValueOnce(loginResponse);
    // /me hydration succeeds and fills permissions
    vi.mocked(loginApi.getMe).mockResolvedValueOnce(fullUser);

    const success = await useAuthStore.getState().login('test@fleetvision.io', 'pw', 'tenant-789');

    expect(success).toBe(true);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.accessToken).toBe('access-123');
    expect(state.refreshToken).toBe('refresh-456');
    expect(state.tenantId).toBe('tenant-789');
    expect(state.user?.tenantId).toBe('tenant-789');
    expect(state.user?.roles).toEqual(['admin']);
    // Full profile (with permissions) was hydrated from /me
    expect(state.user?.permissions).toEqual(['iam.user.read']);
    expect(state.error).toBeNull();
  });

  it('login sends the form org name even when a stale tenant UUID is stored', async () => {
    localStorageMock.setItem(
      'fleetvision_tokens',
      JSON.stringify({
        accessToken: 'dead-access',
        refreshToken: 'dead-refresh',
        tenantId: '00000000-0000-0000-0000-000000000000',
      }),
    );
    localStorageMock.setItem('fleetvision_tenant_id', '00000000-0000-0000-0000-000000000000');
    vi.mocked(loginApi.login).mockResolvedValueOnce(loginResponse);
    vi.mocked(loginApi.getMe).mockResolvedValueOnce(fullUser);

    await useAuthStore.getState().login('test@fleetvision.io', 'pw', 'FleetVision');

    expect(loginApi.login).toHaveBeenCalledWith('test@fleetvision.io', 'pw', 'FleetVision');
    expect(useAuthStore.getState().tenantId).toBe('tenant-789');
  });

  it('login resolves false and clears tokens on failure', async () => {
    vi.mocked(loginApi.login).mockRejectedValueOnce(new Error('Invalid credentials'));

    const success = await useAuthStore.getState().login('x@y.z', 'bad', 'tenant-789');

    expect(success).toBe(false);
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.accessToken).toBeNull();
    expect(state.error).toBe('Invalid credentials');
  });

  it('logout clears all state', async () => {
    useAuthStore.setState({
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      user: {
        id: 'user-1',
        email: 'test@fleetvision.io',
        tenantId: 'tenant-789',
        roles: ['admin'],
        permissions: ['iam.user.read'],
      } satisfies User,
      tenantId: 'tenant-789',
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.tenantId).toBeNull();
  });
});

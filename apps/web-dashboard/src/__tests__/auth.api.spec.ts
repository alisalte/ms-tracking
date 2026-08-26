import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the HTTP client helpers so the mapping is tested in isolation — no
// axios, no network. The mock returns whatever we resolve, simulating the raw
// wire payload (snake_case) the client would unwrap from the `{ data }` envelope.
vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPostNoContent: vi.fn(),
  apiClient: {},
}));

import { getMe, login, refreshToken } from '@/api/auth.api';
import { apiGet, apiPost } from '@/api/client';
import type { LoginResponseWire, MeResponseWire, RefreshResponseWire } from '@/types/auth.types';

const apiGetMock = vi.mocked(apiGet);
const apiPostMock = vi.mocked(apiPost);

const loginWire: LoginResponseWire = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  token_type: 'Bearer',
  expires_in: 900,
  user: { id: 'u1', email: 'a@b.io', tenant_id: 't1', roles: ['admin'] },
};

const refreshWire: RefreshResponseWire = {
  access_token: 'access-2',
  refresh_token: 'refresh-2',
  expires_in: 900,
};

const meWire: MeResponseWire = {
  id: 'u1',
  email: 'a@b.io',
  tenant_id: 't1',
  roles: ['admin'],
  permissions: ['iam.user.read'],
};

describe('auth.api (snake_case → camelCase boundary mapping)', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
  });

  it('login() maps the snake_case wire response to camelCase', async () => {
    apiPostMock.mockResolvedValueOnce(loginWire);

    const result = await login('a@b.io', 'pw', 'FleetVision');

    expect(apiPostMock).toHaveBeenCalledWith(
      '/auth/login',
      { email: 'a@b.io', password: 'pw' },
      { headers: { 'X-Tenant-Id': 'FleetVision' } },
    );
    expect(result).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { id: 'u1', email: 'a@b.io', tenantId: 't1', roles: ['admin'] },
    });
  });

  it('refreshToken() sends snake_case refresh_token and maps the response', async () => {
    apiPostMock.mockResolvedValueOnce(refreshWire);

    const result = await refreshToken('refresh-old');

    expect(apiPostMock).toHaveBeenCalledWith('/auth/refresh', {
      refresh_token: 'refresh-old',
    });
    expect(result).toEqual({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresIn: 900,
    });
  });

  it('getMe() maps the snake_case /me payload to a camelCase User', async () => {
    apiGetMock.mockResolvedValueOnce(meWire);

    const result = await getMe();

    expect(apiGetMock).toHaveBeenCalledWith('/auth/me');
    expect(result).toEqual({
      id: 'u1',
      email: 'a@b.io',
      tenantId: 't1',
      roles: ['admin'],
      permissions: ['iam.user.read'],
    });
  });
});

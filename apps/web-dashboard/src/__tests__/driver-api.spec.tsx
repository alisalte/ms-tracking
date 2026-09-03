/**
 * Driver list wire-contract: fleet-service uses pageRequestSchema
 * (MAX_PAGE_SIZE=100). Same oversize-limit 400 as the rules page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDrivers } from '@/api/driver.api';
import { MAX_PAGE_SIZE } from '@/lib/pagination';

const apiGetRaw = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: { interceptors: { request: { use: () => {} }, response: { use: () => {} } } },
  apiGet: vi.fn(),
  apiGetRaw: (...a: unknown[]) => apiGetRaw(...a),
  apiPost: vi.fn(),
  apiPostNoContent: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  apiDeleteNoContent: vi.fn(),
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('fleetvision_use_mock', 'false');
});

describe('driver list pagination (pageRequestSchema max 100)', () => {
  it('requests limit at MAX_PAGE_SIZE', async () => {
    apiGetRaw.mockResolvedValueOnce({ data: [], nextCursor: null });

    const { result } = renderHook(() => useDrivers(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGetRaw).toHaveBeenCalledWith('/fleet/drivers', {
      limit: MAX_PAGE_SIZE,
    });
  });
});

/**
 * Alarm-rule list wire-contract: notification-service uses pageRequestSchema
 * (MAX_PAGE_SIZE=100). Requesting 200 produced HTTP 400 "limit must be <= 100"
 * on /rules.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAlarmRules } from '@/api/rule.api';
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

const ruleWire = {
  id: 'rule-1',
  tenantId: 't1',
  name: 'City overspeed 80',
  type: 'overspeed',
  severity: 'HIGH',
  enabled: true,
  entityType: 'vehicle',
  entityId: null,
  conditions: { thresholdKmh: 80 },
  cooldownSec: 300,
  dedupWindowSec: 600,
  repeatPolicy: 'COOLDOWN',
  version: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('fleetvision_use_mock', 'false');
});

describe('alarm rule list pagination (pageRequestSchema max 100)', () => {
  it('requests limit at MAX_PAGE_SIZE and follows the cursor chain', async () => {
    apiGetRaw
      .mockResolvedValueOnce({ data: [ruleWire], nextCursor: 'cur-1' })
      .mockResolvedValueOnce({
        data: [{ ...ruleWire, id: 'rule-2', name: 'Idle 10m' }],
        nextCursor: null,
      });

    const { result } = renderHook(() => useAlarmRules(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.map((r) => r.id)).toEqual(['rule-1', 'rule-2']);

    expect(apiGetRaw).toHaveBeenCalledTimes(2);
    expect(apiGetRaw).toHaveBeenNthCalledWith(1, '/notification/rules', {
      limit: MAX_PAGE_SIZE,
    });
    expect(apiGetRaw).toHaveBeenNthCalledWith(2, '/notification/rules', {
      limit: MAX_PAGE_SIZE,
      cursor: 'cur-1',
    });
  });
});

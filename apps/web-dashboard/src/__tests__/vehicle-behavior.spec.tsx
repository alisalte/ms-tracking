/**
 * Vehicle behavior wire-contract + panel: GET /fleet/vehicles/:id/behavior-score
 * and /behavior-events (fleet-service), rendered in the vehicle drawer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVehicleBehavior, useVehicleBehaviorEvents } from '@/api/driver.api';
import { VehicleBehaviorPanel } from '@/components/assets/VehicleBehaviorPanel';

const apiGet = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: { interceptors: { request: { use: () => {} }, response: { use: () => {} } } },
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiGetRaw: vi.fn(),
  apiPost: vi.fn(),
  apiPostNoContent: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  apiDeleteNoContent: vi.fn(),
}));

const VEHICLE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const SCORE = {
  vehicleId: VEHICLE,
  periodStart: '2026-09-01T00:00:00.000Z',
  periodEnd: '2026-10-01T00:00:00.000Z',
  score: 81,
  harshBrake: 2,
  rapidAccel: 1,
  speedViolation: 1,
  excessiveIdle: 1,
  eventCount: 5,
  unattributedCount: 1,
  previousScore: 90,
  delta: -9,
  needsAttention: false,
  drivers: [
    {
      driverId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      firstName: 'Ali',
      lastName: 'Rezaei',
      score: 87,
      eventCount: 4,
      harshBrake: 2,
      rapidAccel: 1,
      speedViolation: 1,
      excessiveIdle: 0,
    },
  ],
};

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

describe('vehicle behavior API', () => {
  it('maps the score payload including the per-driver split', async () => {
    apiGet.mockResolvedValueOnce(SCORE);
    const { result } = renderHook(() => useVehicleBehavior(VEHICLE), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith(`/fleet/vehicles/${VEHICLE}/behavior-score`);
    expect(result.current.data).toMatchObject({
      score: 81,
      harshBrakeCount: 2,
      rapidAccelCount: 1,
      speedViolationCount: 1,
      excessiveIdleCount: 1,
      unattributedCount: 1,
      previousScore: 90,
      delta: -9,
      drivers: [
        { firstName: 'Ali', lastName: 'Rezaei', score: 87, eventCount: 4, harshBrakeCount: 2 },
      ],
    });
  });

  it('maps events with their attributed driver', async () => {
    apiGet.mockResolvedValueOnce([
      {
        id: 'e1',
        type: 'HARSH_BRAKE',
        severity: 'WARNING',
        vehicleId: VEHICLE,
        driverId: null,
        raisedAt: '2026-09-05T10:00:00.000Z',
        sourceAlarmId: 'a1',
      },
    ]);
    const { result } = renderHook(() => useVehicleBehaviorEvents(VEHICLE), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith(`/fleet/vehicles/${VEHICLE}/behavior-events`);
    expect(result.current.data?.[0]).toMatchObject({ type: 'HARSH_BRAKE', driverId: null });
  });

  it('does not fetch without a vehicle id', () => {
    renderHook(() => useVehicleBehavior(null), { wrapper: makeWrapper() });
    expect(apiGet).not.toHaveBeenCalled();
  });
});

describe('VehicleBehaviorPanel', () => {
  it('shows score, delta and the drivers behind the wheel', async () => {
    apiGet.mockImplementation(async (url: string) =>
      url.endsWith('/behavior-score') ? SCORE : [],
    );
    render(<VehicleBehaviorPanel vehicleId={VEHICLE} drivers={[]} />, { wrapper: makeWrapper() });

    expect(await screen.findByText('81')).toBeTruthy();
    expect(screen.getByText('Ali Rezaei')).toBeTruthy();
    expect(screen.getByText('87')).toBeTruthy();
  });

  it('shows the empty state when the vehicle has no events', async () => {
    apiGet.mockImplementation(async (url: string) =>
      url.endsWith('/behavior-score') ? { ...SCORE, score: 100, eventCount: 0, drivers: [] } : [],
    );
    render(<VehicleBehaviorPanel vehicleId={VEHICLE} drivers={[]} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText('100')).toBeTruthy());
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});

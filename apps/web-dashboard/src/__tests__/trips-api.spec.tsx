/**
 * Trips API wire-mapping tests (Sprint F §11): the REAL gps-engine /trips
 * responses map onto the UI Trip/TripDetail shapes — honest defaults where the
 * projection lacks a field, never fabricated values.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTripDetail, useTrips } from '@/api/fleet.api';

const apiGetRaw = vi.fn();
const apiGet = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: { interceptors: { request: { use: () => {} }, response: { use: () => {} } } },
  apiGet: (...a: unknown[]) => apiGet(...a),
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

const tripWire = {
  id: '5b2a7c9e-0000-4000-8000-000000000001',
  vehicleId: '5b2a7c9e-0000-4000-8000-000000000002',
  status: 'COMPLETED',
  startedAt: '2026-08-15T08:00:00Z',
  endedAt: '2026-08-15T09:00:00Z',
  startLat: 35.7,
  startLng: 51.4,
  endLat: 35.75,
  endLng: 51.45,
  distanceKm: 60.25,
  durationS: 3600,
  maxSpeedKmh: 90.4,
  stopCount: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('fleetvision_use_mock', 'false');
});

describe('useTrips (real /trips mapping)', () => {
  it('maps the wire rows onto Trip with derived averages and registry labels', async () => {
    apiGetRaw.mockImplementation(async (url: string) => {
      if (url === '/trips') return [tripWire];
      // registry join (vehicles list Page — raw body)
      return {
        data: [
          {
            id: tripWire.vehicleId,
            name: 'Truck 7',
            code: 'V007',
            plate: '11-B-22',
          },
        ],
        nextCursor: null,
      };
    });

    const { result } = renderHook(() => useTrips(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    const trip = result.current.data?.[0];
    expect(trip).toMatchObject({
      id: tripWire.id,
      vehicleId: tripWire.vehicleId,
      vehicleLabel: 'Truck 7 · 11-B-22',
      status: 'completed',
      startTime: '2026-08-15T08:00:00Z',
      endTime: '2026-08-15T09:00:00Z',
      distanceKm: 60.3,
      durationMin: 60,
      maxSpeed: 90,
      avgSpeed: 60.3, // 60.25 km / 1 h
      stopCount: 2,
    });
    // Origin/destination are coordinates — addresses are NOT fabricated.
    expect(trip?.originLabel).toBe('35.7000, 51.4000');
    expect(trip?.destinationLabel).toBe('35.7500, 51.4500');
    // Idle totals are not part of the list projection.
    expect(trip?.idleMin).toBeUndefined();
  });

  it('maps ACTIVE trips to in_progress and tolerates a registry failure', async () => {
    apiGetRaw.mockImplementation(async (url: string) => {
      if (url === '/trips')
        return [{ ...tripWire, status: 'ACTIVE', endedAt: null, endLat: null, endLng: null }];
      throw new Error('registry unreachable');
    });

    const { result } = renderHook(() => useTrips(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].status).toBe('in_progress');
    expect(result.current.data?.[0].endTime).toBeUndefined();
    expect(result.current.data?.[0].destinationLabel).toBe('—');
    // No title when the registry is down — never show a truncated GUID.
    expect(result.current.data?.[0].vehicleLabel).toBe('');
  });
});

describe('useTripDetail (real /trips/:id mapping)', () => {
  it('composes waypoints + events and sums idle time from events', async () => {
    apiGetRaw.mockResolvedValueOnce({
      ...tripWire,
      avgSpeedKph: 60.3,
      waypoints: [
        { ts: '2026-08-15T08:00:00Z', lat: 35.7, lng: 51.4, speed: 40, heading: 90 },
        { ts: '2026-08-15T08:30:00Z', lat: 35.72, lng: 51.42, speed: 55, heading: 95 },
      ],
      events: [
        {
          id: 'idle-0',
          type: 'idle',
          ts: '2026-08-15T08:10:00Z',
          lat: null,
          lng: null,
          durationMin: 5,
        },
        {
          id: 'stop-0',
          type: 'stop',
          ts: '2026-08-15T08:20:00Z',
          lat: 35.71,
          lng: 51.41,
          durationMin: 10,
        },
      ],
    });

    const { result } = renderHook(() => useTripDetail(tripWire.id), { wrapper: makeWrapper() });
    await waitFor(() =>
      expect(result.current.data !== undefined && result.current.data !== null).toBe(true),
    );
    expect(result.current.isError).toBe(false);

    const detail = result.current.data;
    expect(detail?.waypoints).toHaveLength(2);
    expect(detail?.waypoints[0]).toMatchObject({ lat: 35.7, lng: 51.4, speed: 40 });
    expect(detail?.idleMin).toBe(5);
    // Stop event keeps its coordinates; idle is pinned to the nearest sample (08:10 → 08:00).
    const stop = detail?.events.find((e) => e.type === 'stop');
    const idle = detail?.events.find((e) => e.type === 'idle');
    expect(stop?.lat).toBe(35.71);
    expect(idle?.lat).toBe(35.7);
    expect(idle?.lng).toBe(51.4);
  });

  it('derives overspeed markers from waypoints above the posted limit', async () => {
    apiGetRaw.mockResolvedValueOnce({
      ...tripWire,
      avgSpeedKph: 60.3,
      waypoints: [
        { ts: '2026-08-15T08:00:00Z', lat: 35.7, lng: 51.4, speed: 40, heading: 90 },
        { ts: '2026-08-15T08:20:00Z', lat: 35.73, lng: 51.43, speed: 118, heading: 10 },
      ],
      events: [],
    });

    const { result } = renderHook(() => useTripDetail(tripWire.id), { wrapper: makeWrapper() });
    await waitFor(() =>
      expect(result.current.data !== undefined && result.current.data !== null).toBe(true),
    );
    const overspeed = result.current.data?.events.find((e) => e.type === 'overspeed');
    expect(overspeed?.lat).toBe(35.73);
    expect(overspeed?.label).toBe('118 km/h');
  });

  it('propagates a 404 instead of faking a trip', async () => {
    apiGetRaw.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }));
    const { result } = renderHook(() => useTripDetail('missing'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('trips query gating', () => {
  it('does not fetch in real mode when mock mode is off and API errors propagate', async () => {
    apiGetRaw.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useTrips(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

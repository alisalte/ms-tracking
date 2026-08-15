/**
 * Asset registry API wire-contract tests (Sprint E §29).
 *
 * These pin the exact HTTP contracts the hooks use against the REAL
 * fleet-management backend — including the Page<T> cursor shape, which is
 * returned RAW (not { data }-enveloped) by the list endpoints and therefore
 * must be fetched with apiGetRaw (the envelope-unwrapping apiGet would lose
 * `nextCursor` — the bug these tests guard against).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useArchiveFleet,
  useBindDeviceToVehicle,
  useCreateDevice,
  useCreateFleet,
  useCreateVehicle,
  useDecommissionDevice,
  useFleets,
  useUnbindDeviceFromVehicle,
  useUpdateFleet,
} from '@/api/asset.api';

const apiGetRaw = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDeleteNoContent = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: { interceptors: { request: { use: () => {} }, response: { use: () => {} } } },
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiGetRaw: (...a: unknown[]) => apiGetRaw(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPostNoContent: vi.fn(),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiDeleteNoContent: (...a: unknown[]) => apiDeleteNoContent(...a),
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const fleetWire = (id: string) => ({
  id,
  tenantId: 't1',
  name: `Fleet ${id}`,
  code: `F${id}`,
  description: null,
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  // The global test setup enables mock mode for component tests; these are
  // REAL-mode wire-contract tests, so force the real-first path.
  window.localStorage.setItem('fleetvision_use_mock', 'false');
});

describe('fleet list pagination (Page<T> is RAW — fetched via apiGetRaw)', () => {
  it('follows the cursor chain and concatenates pages', async () => {
    apiGetRaw
      .mockResolvedValueOnce({ data: [fleetWire('1'), fleetWire('2')], nextCursor: 'cur-1' })
      .mockResolvedValueOnce({ data: [fleetWire('3')], nextCursor: null });

    const { result } = renderHook(() => useFleets(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(result.current.data?.map((f) => f.id)).toEqual(['1', '2', '3']);

    expect(apiGetRaw).toHaveBeenCalledTimes(2);
    expect(apiGetRaw).toHaveBeenNthCalledWith(1, '/fleets', { limit: 200 });
    expect(apiGetRaw).toHaveBeenNthCalledWith(2, '/fleets', { limit: 200, cursor: 'cur-1' });
  });

  it('forwards list filters as query params', async () => {
    apiGetRaw.mockResolvedValueOnce({ data: [], nextCursor: null });
    const { result } = renderHook(() => useFleets({ search: 'north' }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(apiGetRaw).toHaveBeenCalledWith('/fleets', { limit: 200, search: 'north' });
  });

  it('propagates real HTTP errors instead of faking an empty list', async () => {
    apiGetRaw.mockRejectedValueOnce(new Error('Request failed with status code 403'));
    const { result } = renderHook(() => useFleets(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('fleet CRUD mutations (real fleet-management endpoints)', () => {
  it('creates via POST /fleets', async () => {
    apiPost.mockResolvedValueOnce(fleetWire('9'));
    const { result } = renderHook(() => useCreateFleet(), { wrapper: makeWrapper() });
    await act(async () => {
      result.current.mutate({ name: 'North', code: 'NORTH' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPost).toHaveBeenCalledWith('/fleets', { name: 'North', code: 'NORTH' });
  });

  it('updates via PATCH /fleets/:id', async () => {
    apiPatch.mockResolvedValueOnce(fleetWire('9'));
    const { result } = renderHook(() => useUpdateFleet(), { wrapper: makeWrapper() });
    await act(async () => {
      result.current.mutate({ id: '9', changes: { name: 'North 2', code: 'NORTH' } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPatch).toHaveBeenCalledWith('/fleets/9', { name: 'North 2', code: 'NORTH' });
  });

  it('archives via DELETE /fleets/:id (204)', async () => {
    apiDeleteNoContent.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useArchiveFleet(), { wrapper: makeWrapper() });
    await act(async () => {
      result.current.mutate('9');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiDeleteNoContent).toHaveBeenCalledWith('/fleets/9');
  });

  it('creates a vehicle via POST /vehicles with its fleet binding', async () => {
    apiPost.mockResolvedValueOnce({ ...fleetWire('v1'), fleetId: 'f1' });
    const { result } = renderHook(() => useCreateVehicle(), { wrapper: makeWrapper() });
    await act(async () => {
      result.current.mutate({ fleetId: 'f1', name: 'Truck 1', code: 'V01', plate: '11-B-22' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPost).toHaveBeenCalledWith('/vehicles', {
      fleetId: 'f1',
      name: 'Truck 1',
      code: 'V01',
      plate: '11-B-22',
    });
  });

  it('creates a device via POST /devices with its protocol', async () => {
    apiPost.mockResolvedValueOnce({ ...fleetWire('d1'), imei: '490154203237518' });
    const { result } = renderHook(() => useCreateDevice(), { wrapper: makeWrapper() });
    await act(async () => {
      result.current.mutate({
        imei: '490154203237518',
        manufacturer: 'Teltonika',
        model: 'FMB920',
        protocol: 'gt06',
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPost).toHaveBeenCalledWith('/devices', {
      imei: '490154203237518',
      manufacturer: 'Teltonika',
      model: 'FMB920',
      protocol: 'gt06',
    });
  });

  it('decommissions via DELETE /devices/:id (204)', async () => {
    apiDeleteNoContent.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDecommissionDevice(), { wrapper: makeWrapper() });
    await act(async () => {
      result.current.mutate('d1');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiDeleteNoContent).toHaveBeenCalledWith('/devices/d1');
  });
});

describe('vehicle ↔ device assignment (§11)', () => {
  it('binds via POST /vehicles/:id/devices/:deviceId', async () => {
    apiPost.mockResolvedValueOnce({ deviceId: 'd1', role: 'primary', isPrimary: true });
    const { result } = renderHook(() => useBindDeviceToVehicle(), { wrapper: makeWrapper() });
    await act(async () => {
      result.current.mutate({ vehicleId: 'v1', deviceId: 'd1', isPrimary: true });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPost).toHaveBeenCalledWith('/vehicles/v1/devices/d1', { isPrimary: true });
  });

  it('surfaces a 409 already-assigned conflict as a mutation error', async () => {
    apiPost.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }));
    const { result } = renderHook(() => useBindDeviceToVehicle(), { wrapper: makeWrapper() });
    await act(async () => {
      result.current.mutate({ vehicleId: 'v1', deviceId: 'd1' });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(apiPost).toHaveBeenCalledWith('/vehicles/v1/devices/d1', {});
  });

  it('unbinds via DELETE /vehicles/:id/devices/:deviceId (204)', async () => {
    apiDeleteNoContent.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useUnbindDeviceFromVehicle(), { wrapper: makeWrapper() });
    await act(async () => {
      result.current.mutate({ vehicleId: 'v1', deviceId: 'd1' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiDeleteNoContent).toHaveBeenCalledWith('/vehicles/v1/devices/d1');
  });
});

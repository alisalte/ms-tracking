/**
 * Asset Management API + data hooks.
 *
 * The Asset Management page (Fleet/Driver/Telemetry module docs) needs the
 * vehicle, driver, device, and group registries + a few status actions
 * (transfer, maintenance toggle). None of these endpoints exist in the backend
 * yet — so each query resolves from static mock data (`mock/asset-data.ts`)
 * with a small latency to mimic a real fetch and exercise the loading skeleton
 * states. When the REST endpoints land, swap the mock body for `apiGet` and
 * the hooks stay unchanged.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock } from '@/lib/mock-gate';
import {
  mockDeviceDetail,
  mockDevices,
  mockDriverDetail,
  mockDrivers,
  mockGroups,
  mockVehicleDetail,
  mockVehicles,
} from '@/mock/asset-data';
import type { Device, Driver, Vehicle, VehicleGroup } from '@/types/asset.types';
import { queryKeys } from './query-keys';

// ── Fetchers (swap mock → apiGet when backends land) ─────────────────────────

/** GET /api/v1/fleet/vehicles (pending backend). */
function fetchVehicles(): Promise<Vehicle[]> {
  return resolveMock(mockVehicles);
}

/** GET /api/v1/fleet/vehicles/{id} (pending backend). */
function fetchVehicleDetail(id: string): Promise<Vehicle | undefined> {
  return resolveMock(mockVehicleDetail(id));
}

/** GET /api/v1/drivers (pending backend). */
function fetchDrivers(): Promise<Driver[]> {
  return resolveMock(mockDrivers);
}

/** GET /api/v1/drivers/{id} (pending backend). */
function fetchDriverDetail(id: string): Promise<Driver | undefined> {
  return resolveMock(mockDriverDetail(id));
}

/** GET /api/v1/telemetry/devices (pending backend). */
function fetchDevices(): Promise<Device[]> {
  return resolveMock(mockDevices);
}

/** GET /api/v1/telemetry/devices/{id} (pending backend). */
function fetchDeviceDetail(id: string): Promise<Device | undefined> {
  return resolveMock(mockDeviceDetail(id));
}

/** GET /api/v1/fleet/groups (pending backend). */
function fetchGroups(): Promise<VehicleGroup[]> {
  return resolveMock(mockGroups);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Vehicle registry. */
export function useVehicles() {
  return useQuery({ queryKey: queryKeys.assets.vehicles(), queryFn: fetchVehicles });
}
export function useVehicleDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.assets.vehicleDetail(id) : ['assets', 'vehicle', 'none'],
    queryFn: () => fetchVehicleDetail(id as string),
    enabled: Boolean(id),
  });
}

/** Driver registry. */
export function useDrivers() {
  return useQuery({ queryKey: queryKeys.assets.drivers(), queryFn: fetchDrivers });
}
export function useDriverDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.assets.driverDetail(id) : ['assets', 'driver', 'none'],
    queryFn: () => fetchDriverDetail(id as string),
    enabled: Boolean(id),
  });
}

/** Device registry. */
export function useDevices() {
  return useQuery({ queryKey: queryKeys.assets.devices(), queryFn: fetchDevices });
}
export function useDeviceDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.assets.deviceDetail(id) : ['assets', 'device', 'none'],
    queryFn: () => fetchDeviceDetail(id as string),
    enabled: Boolean(id),
  });
}

/** Vehicle groups. */
export function useGroups() {
  return useQuery({ queryKey: queryKeys.assets.groups(), queryFn: fetchGroups });
}

/**
 * Optimistic vehicle status action — transfer to another fleet or toggle
 * maintenance (Fleet-Management §5.1). Mock: updates the cache in place; rolls
 * back on failure.
 */
export function useVehicleStatusAction() {
  const qc = useQueryClient();
  return useMutation<
    Vehicle,
    Error,
    { id: string; status: Vehicle['status'] },
    { prev: Vehicle[] | undefined }
  >({
    mutationFn: async ({ id, status }) => {
      const base = mockVehicleDetail(id);
      if (!base) throw new Error(`vehicle ${id} not found`);
      return resolveMock({
        ...base,
        status,
        updatedAt: new Date().toISOString(),
      } satisfies Vehicle);
    },
    onMutate: async ({ id, status }) => {
      const listKey = queryKeys.assets.vehicles();
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<Vehicle[]>(listKey);
      qc.setQueryData<Vehicle[]>(listKey, (old) =>
        (old ?? []).map((v) =>
          v.id === id ? { ...v, status, updatedAt: new Date().toISOString() } : v,
        ),
      );
      qc.setQueryData<Vehicle | undefined>(queryKeys.assets.vehicleDetail(id), (old) =>
        old ? { ...old, status } : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.assets.vehicles(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

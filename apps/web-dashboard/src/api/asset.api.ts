/**
 * Asset registry API + data hooks — REAL fleet-management backend (Sprint E).
 *
 *   GET    /fleets                    (?cursor&limit&status&search)  → Page<Fleet>
 *   POST   /fleets                    { name, code, description? }
 *   GET    /fleets/:id
 *   PATCH  /fleets/:id                (full replace: name+code required)
 *   DELETE /fleets/:id                (204 — SOFT ARCHIVE)
 *   GET    /vehicles                  (?cursor&limit&fleetId&status&search)
 *   POST   /vehicles                  { fleetId, name, code, plate?, vin? }
 *   PATCH  /vehicles/:id              (full replace)
 *   DELETE /vehicles/:id              (204 — SOFT ARCHIVE)
 *   GET    /devices                   (?cursor&limit&status&protocol&vehicleId&imei&search)
 *   POST   /devices                   { imei, serialNumber?, manufacturer?, model?, protocol }
 *   PATCH  /devices/:id               (imei immutable; status/manufacturer/… updatable)
 *   DELETE /devices/:id               (204 — DECOMMISSION)
 *   GET    /vehicles/:id/devices      → BoundDevice[] (the vehicle↔device binding)
 *   POST   /vehicles/:id/devices/:deviceId   { role?, isPrimary? } (bind; 409 when already bound)
 *   DELETE /vehicles/:id/devices/:deviceId   (unbind; 204)
 *
 * Lists paginate with an opaque cursor (`Page<T> { data, nextCursor }`); the
 * registry hooks follow the cursor to the end (bounded) so existing DataTable
 * UX keeps working — server-side pagination can come later without changing
 * these contracts. Mock mode (`?useMock=true`, dev/demo only) substitutes the
 * deterministic fixture dataset adapted to the REAL shapes; production is
 * real-only (Sprint E §31).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import { mockMapVehicles } from '@/mock/fleet-data';
import type {
  BindDevicePayload,
  BoundDevice,
  CreateDevicePayload,
  CreateFleetPayload,
  CreateVehiclePayload,
  Device,
  DeviceProtocol,
  DeviceStatus,
  Fleet,
  FleetStatus,
  UpdateDevicePayload,
  UpdateFleetPayload,
  UpdateVehiclePayload,
  Vehicle,
  VehicleStatus,
} from '@/types/asset.types';
import type { Page } from '@/types/api.types';
import { apiDeleteNoContent, apiGet, apiPatch, apiPost } from './client';
import { queryKeys } from './query-keys';

// ── Cursor-pagination follower ───────────────────────────────────────────────

const PAGE_SIZE = 200;
const MAX_PAGES = 50; // hard bound (10k rows) — never loop a broken cursor forever

/** Follow the cursor chain to exhaustion and return every row. */
async function fetchAll<T>(path: string, params?: Record<string, unknown>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await apiGet<Page<T>>(path, { ...params, limit: PAGE_SIZE, cursor });
    out.push(...result.data);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return out;
}

// ── Dev/demo fixtures (REAL shapes, derived from the map dataset) ────────────

function mockFleets(): Fleet[] {
  const codes = ['NORTH', 'SOUTH', 'URBAN'];
  return codes.map((code, i) => ({
    id: `mock-fleet-${i + 1}`,
    tenantId: 'mock-tenant',
    name: `${code} Fleet`,
    code,
    description: null,
    status: 'ACTIVE' as FleetStatus,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }));
}

function mockVehicles(): Vehicle[] {
  const fleets = mockFleets();
  return mockMapVehicles.slice(0, 24).map((v, i) => ({
    id: v.id,
    tenantId: 'mock-tenant',
    fleetId: fleets[i % fleets.length]?.id ?? fleets[0]?.id ?? '',
    name: v.label,
    code: `V${String(i + 1).padStart(3, '0')}`,
    plate: v.label,
    vin: null,
    status: 'ACTIVE' as VehicleStatus,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: v.updatedAt ?? '2026-01-01T00:00:00Z',
  }));
}

function mockDevices(): Device[] {
  return mockMapVehicles.slice(0, 16).map((v, i) => ({
    id: `mock-device-${i + 1}`,
    tenantId: 'mock-tenant',
    imei: `4901542032375${String(i).padStart(2, '0')}`,
    serialNumber: `SN-${1000 + i}`,
    manufacturer: 'Teltonika',
    model: 'FMB920',
    protocol: 'gt06' as DeviceProtocol,
    status: 'ACTIVE' as DeviceStatus,
    vehicleId: i < 12 ? v.id : null,
    lastSeenAt: v.updatedAt ?? null,
    connectedAt: null,
    disconnectedAt: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }));
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

export interface AssetListFilters {
  status?: VehicleStatus | DeviceStatus | FleetStatus;
  search?: string;
  fleetId?: string;
  /** Device list only: devices bound to this vehicle. */
  vehicleId?: string;
  protocol?: DeviceProtocol;
}

function fetchFleets(filters?: AssetListFilters): Promise<Fleet[]> {
  if (shouldUseMock()) return resolveMock(mockFleets());
  return withMockFallback(
    () => fetchAll<Fleet>('/fleets', { status: filters?.status, search: filters?.search }),
    () => resolveMock(mockFleets()),
  );
}

function fetchFleetDetail(id: string): Promise<Fleet | undefined> {
  if (shouldUseMock()) return resolveMock(mockFleets().find((f) => f.id === id));
  return withMockFallback(
    async () => apiGet<Fleet>(`/fleets/${id}`),
    async () => undefined,
  );
}

function fetchVehicles(filters?: AssetListFilters): Promise<Vehicle[]> {
  if (shouldUseMock()) return resolveMock(mockVehicles());
  return withMockFallback(
    () =>
      fetchAll<Vehicle>('/vehicles', {
        status: filters?.status,
        search: filters?.search,
        fleetId: filters?.fleetId,
      }),
    () => resolveMock(mockVehicles()),
  );
}

function fetchVehicleDetail(id: string): Promise<Vehicle | undefined> {
  if (shouldUseMock()) return resolveMock(mockVehicles().find((v) => v.id === id));
  return withMockFallback(
    async () => apiGet<Vehicle>(`/vehicles/${id}`),
    async () => undefined,
  );
}

function fetchDevices(filters?: AssetListFilters): Promise<Device[]> {
  if (shouldUseMock()) return resolveMock(mockDevices());
  return withMockFallback(
    () =>
      fetchAll<Device>('/devices', {
        status: filters?.status,
        search: filters?.search,
        vehicleId: filters?.vehicleId,
        protocol: filters?.protocol,
      }),
    () => resolveMock(mockDevices()),
  );
}

function fetchDeviceDetail(id: string): Promise<Device | undefined> {
  if (shouldUseMock()) return resolveMock(mockDevices().find((d) => d.id === id));
  return withMockFallback(
    async () => apiGet<Device>(`/devices/${id}`),
    async () => undefined,
  );
}

/** Devices bound to a vehicle (GET /vehicles/:id/devices). */
function fetchVehicleDevices(vehicleId: string): Promise<BoundDevice[]> {
  if (shouldUseMock()) {
    return resolveMock(
      mockDevices()
        .filter((d) => d.vehicleId === vehicleId)
        .map<BoundDevice>((d) => ({
          deviceId: d.id,
          imei: d.imei,
          manufacturer: d.manufacturer,
          model: d.model,
          protocol: d.protocol,
          deviceStatus: d.status,
          role: 'TRACKER',
          isPrimary: true,
          boundAt: d.createdAt,
        })),
    );
  }
  return withMockFallback(
    () => apiGet<BoundDevice[]>(`/vehicles/${vehicleId}/devices`),
    () => resolveMock([]),
  );
}

/**
 * The full vehicle + device registries in ONE call pair (map bootstrap helper
 * used by fleet.api.ts). Bounded by the cursor follower.
 */
export async function fetchAllVehiclesAsMap(): Promise<{
  vehicles: Array<Pick<Vehicle, 'id' | 'name' | 'code' | 'plate'>>;
  devices: Array<Pick<Device, 'id' | 'vehicleId'>>;
}> {
  if (shouldUseMock()) {
    return resolveMock({ vehicles: mockVehicles(), devices: mockDevices() });
  }
  const [vehicles, devices] = await Promise.all([
    fetchAll<Vehicle>('/vehicles', { status: 'ACTIVE' }),
    fetchAll<Device>('/devices'),
  ]);
  return { vehicles, devices };
}

// ── LIST/DETAIL hooks ────────────────────────────────────────────────────────

/** Fleet registry. */
export function useFleets(filters?: AssetListFilters) {
  return useQuery({
    queryKey: [...queryKeys.assets.all, 'fleets', filters ?? {}],
    queryFn: () => fetchFleets(filters),
  });
}
export function useFleetDetail(id: string | null) {
  return useQuery({
    queryKey: id ? [...queryKeys.assets.all, 'fleet', id] : ['assets', 'fleet', 'none'],
    queryFn: () => fetchFleetDetail(id as string),
    enabled: Boolean(id),
  });
}

/** Vehicle registry. */
export function useVehicles(filters?: AssetListFilters) {
  return useQuery({
    queryKey: [...queryKeys.assets.all, 'vehicles', filters ?? {}],
    queryFn: () => fetchVehicles(filters),
  });
}
export function useVehicleDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.assets.vehicleDetail(id) : ['assets', 'vehicle', 'none'],
    queryFn: () => fetchVehicleDetail(id as string),
    enabled: Boolean(id),
  });
}

/** Device registry. */
export function useDevices(filters?: AssetListFilters) {
  return useQuery({
    queryKey: [...queryKeys.assets.all, 'devices', filters ?? {}],
    queryFn: () => fetchDevices(filters),
  });
}
export function useDeviceDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.assets.deviceDetail(id) : ['assets', 'device', 'none'],
    queryFn: () => fetchDeviceDetail(id as string),
    enabled: Boolean(id),
  });
}

/** Devices bound to a vehicle (the assignment list). */
export function useVehicleDevices(vehicleId: string | null) {
  return useQuery({
    queryKey: vehicleId
      ? [...queryKeys.assets.all, 'vehicleDevices', vehicleId]
      : ['assets', 'vehicleDevices', 'none'],
    queryFn: () => fetchVehicleDevices(vehicleId as string),
    enabled: Boolean(vehicleId),
  });
}

// ── Fleet CRUD mutations ─────────────────────────────────────────────────────

/** Create a fleet (POST /fleets). */
export function useCreateFleet() {
  const qc = useQueryClient();
  return useMutation<Fleet, Error, CreateFleetPayload>({
    mutationFn: (payload) => apiPost<CreateFleetPayload, Fleet>('/fleets', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Update a fleet (PATCH /fleets/:id — full replace, 409 on version/code conflict). */
export function useUpdateFleet() {
  const qc = useQueryClient();
  return useMutation<Fleet, Error, { id: string; changes: UpdateFleetPayload }>({
    mutationFn: ({ id, changes }) => apiPatch<UpdateFleetPayload, Fleet>(`/fleets/${id}`, changes),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: [...queryKeys.assets.all, 'fleet', id] });
      qc.invalidateQueries({ queryKey: queryKeys.assets.all });
    },
  });
}

/** Archive a fleet (DELETE /fleets/:id — soft archive, 204). */
export function useArchiveFleet() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteNoContent(`/fleets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

// ── Vehicle CRUD mutations ───────────────────────────────────────────────────

/** Create a vehicle (POST /vehicles). */
export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation<Vehicle, Error, CreateVehiclePayload>({
    mutationFn: (payload) => apiPost<CreateVehiclePayload, Vehicle>('/vehicles', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Update a vehicle (PATCH /vehicles/:id — full replace). */
export function useUpdateVehicle() {
  const qc = useQueryClient();
  return useMutation<Vehicle, Error, { id: string; changes: UpdateVehiclePayload }>({
    mutationFn: ({ id, changes }) =>
      apiPatch<UpdateVehiclePayload, Vehicle>(`/vehicles/${id}`, changes),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.vehicleDetail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.all });
    },
  });
}

/** Archive a vehicle (DELETE /vehicles/:id — soft archive, 204). */
export function useArchiveVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteNoContent(`/vehicles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}
/** Backwards-compatible alias — DELETE = archive in the backend semantics. */
export const useDeleteVehicle = useArchiveVehicle;

// ── Device CRUD mutations ────────────────────────────────────────────────────

/** Create a device (POST /devices — imei must be 15-digit Luhn-valid). */
export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation<Device, Error, CreateDevicePayload>({
    mutationFn: (payload) => apiPost<CreateDevicePayload, Device>('/devices', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Update a device (PATCH /devices/:id — imei immutable server-side). */
export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation<Device, Error, { id: string; changes: UpdateDevicePayload }>({
    mutationFn: ({ id, changes }) => apiPatch<UpdateDevicePayload, Device>(`/devices/${id}`, changes),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.deviceDetail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.all });
    },
  });
}

/** Decommission a device (DELETE /devices/:id — soft, 204). */
export function useDecommissionDevice() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteNoContent(`/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}
/** Backwards-compatible alias — DELETE = decommission in the backend semantics. */
export const useDeleteDevice = useDecommissionDevice;

// ── Vehicle ↔ Device binding (§11) ───────────────────────────────────────────

/**
 * Bind a device to a vehicle (POST /vehicles/:id/devices/:deviceId).
 * 409 when the device is already bound or would duplicate the primary slot.
 */
export function useBindDeviceToVehicle() {
  const qc = useQueryClient();
  return useMutation<BoundDevice, Error, { vehicleId: string; deviceId: string } & BindDevicePayload>({
    mutationFn: ({ vehicleId, deviceId, role, isPrimary }) =>
      apiPost<BindDevicePayload, BoundDevice>(`/vehicles/${vehicleId}/devices/${deviceId}`, {
        ...(role ? { role } : {}),
        ...(isPrimary !== undefined ? { isPrimary } : {}),
      }),
    onSuccess: (_d, { vehicleId }) => {
      qc.invalidateQueries({ queryKey: [...queryKeys.assets.all, 'vehicleDevices', vehicleId] });
      qc.invalidateQueries({ queryKey: queryKeys.assets.all });
    },
  });
}

/** Unbind a device from its vehicle (DELETE /vehicles/:id/devices/:deviceId, 204). */
export function useUnbindDeviceFromVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, { vehicleId: string; deviceId: string }>({
    mutationFn: ({ vehicleId, deviceId }) =>
      apiDeleteNoContent(`/vehicles/${vehicleId}/devices/${deviceId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

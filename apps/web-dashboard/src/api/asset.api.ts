/**
 * Asset Management API + data hooks.
 *
 * The Asset Management page (Fleet/Driver/Telemetry module docs) needs the
 * vehicle, driver, device, and group registries + full CRUD (create/update/
 * delete) and a few status/assignment actions.
 *
 * Backend status (as of this sprint): the fleet-management-service,
 * driver-management-service, and device-management-service REST endpoints are
 * NOT yet implemented — only identity-service (users/tenants) and map-engine
 * (geofences) have backends. So:
 *   - LIST/DETAIL fetchers use `withMockFallback` (try the real API first, fall
 *     back to mock data on a network error in dev). In production the mock
 *     gate is ON by default so the UI stays demoable; operators can opt into
 *     the real API via `?useMock=false`.
 *   - CREATE/UPDATE/DELETE/ASSIGN mutations call the real REST endpoints via
 *     apiPost/apiPut/apiDelete. They are typed contracts ready for the backend;
 *     in production without a backend they surface a network error honestly
 *     (no fake local mutations). See docs/frontend-crud.md.
 *
 * The wire (`*Wire`) snake_case variants + `mapX(wire)` mappers live below — the
 * single place where wire translation happens, ready for when the services ship.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import {
  mockDeviceDetail,
  mockDevices,
  mockDriverDetail,
  mockDrivers,
  mockGroups,
  mockVehicleDetail,
  mockVehicles,
} from '@/mock/asset-data';
import type {
  CreateDevicePayload,
  CreateDriverPayload,
  CreateGroupPayload,
  CreateVehiclePayload,
  Device,
  Driver,
  UpdateDevicePayload,
  UpdateDriverPayload,
  UpdateGroupPayload,
  UpdateVehiclePayload,
  Vehicle,
  VehicleGroup,
} from '@/types/asset.types';
import { apiDelete, apiGet, apiPost, apiPostNoContent, apiPut } from './client';
import { queryKeys } from './query-keys';

// ── Wire mappers (snake_case ↔ camelCase) ────────────────────────────────────
// Single place for wire translation; ready for when the services ship.

interface VehicleWire {
  id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  license_plate: string;
  color: string;
  fuel_type: Vehicle['fuelType'];
  type: Vehicle['type'];
  status: Vehicle['status'];
  fleet_id: string;
  fleet_name: string;
  group_id?: string;
  group_name?: string;
  device_id?: string;
  odometer_km: number;
  purchase_date?: string;
  warranty_expiry?: string;
  insurance_policy?: string;
  updated_at: string;
}
function mapVehicle(w: VehicleWire): Vehicle {
  return {
    id: w.id,
    vin: w.vin,
    make: w.make,
    model: w.model,
    year: w.year,
    licensePlate: w.license_plate,
    color: w.color,
    fuelType: w.fuel_type,
    type: w.type,
    status: w.status,
    fleetId: w.fleet_id,
    fleetName: w.fleet_name,
    groupId: w.group_id,
    groupName: w.group_name,
    deviceId: w.device_id,
    odometerKm: w.odometer_km,
    purchaseDate: w.purchase_date,
    warrantyExpiry: w.warranty_expiry,
    insurancePolicy: w.insurance_policy,
    updatedAt: w.updated_at,
  };
}
/** Create/Update payload (camelCase) → wire (snake_case). Underscores set server-side are omitted. */
function vehicleToWire(p: CreateVehiclePayload | UpdateVehiclePayload) {
  return {
    license_plate: p.licensePlate,
    vin: p.vin,
    make: p.make,
    model: p.model,
    year: p.year,
    type: p.type,
    fuel_type: p.fuelType,
    color: p.color,
    status: p.status,
    group_id: p.groupId,
    device_id: p.deviceId,
  };
}

interface DriverWire {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  employee_id?: string;
  status: Driver['status'];
  hire_date?: string;
  license_number: string;
  license_class: string;
  license_expiry: string;
  behavior_score: number;
  total_trips: number;
  total_distance_km: number;
  assigned_vehicle_id?: string;
  assigned_vehicle_label?: string;
  certifications: string[];
}
function mapDriver(w: DriverWire): Driver {
  return {
    id: w.id,
    firstName: w.first_name,
    lastName: w.last_name,
    email: w.email,
    phone: w.phone,
    employeeId: w.employee_id,
    status: w.status,
    hireDate: w.hire_date,
    licenseNumber: w.license_number,
    licenseClass: w.license_class,
    licenseExpiry: w.license_expiry,
    behaviorScore: w.behavior_score,
    totalTrips: w.total_trips,
    totalDistanceKm: w.total_distance_km,
    assignedVehicleId: w.assigned_vehicle_id,
    assignedVehicleLabel: w.assigned_vehicle_label,
    certifications: w.certifications,
  };
}
function driverToWire(p: CreateDriverPayload | UpdateDriverPayload) {
  return {
    first_name: p.firstName,
    last_name: p.lastName,
    email: p.email,
    phone: p.phone,
    employee_id: p.employeeId,
    status: p.status,
    license_number: p.licenseNumber,
    license_class: p.licenseClass,
    license_expiry: p.licenseExpiry,
    assigned_vehicle_id: p.assignedVehicleId,
  };
}

interface DeviceWire {
  id: string;
  serial_number: string;
  imei?: string;
  device_type: Device['deviceType'];
  manufacturer: string;
  model: string;
  firmware_version: string;
  target_firmware_version?: string;
  status: Device['status'];
  bound_vehicle_id?: string;
  bound_vehicle_label?: string;
  last_heartbeat_at?: string;
  last_data_at?: string;
  battery_level?: number;
  signal_strength_dbm?: number;
  reporting_interval_sec: number;
}
function mapDevice(w: DeviceWire): Device {
  return {
    id: w.id,
    serialNumber: w.serial_number,
    imei: w.imei,
    deviceType: w.device_type,
    manufacturer: w.manufacturer,
    model: w.model,
    firmwareVersion: w.firmware_version,
    targetFirmwareVersion: w.target_firmware_version,
    status: w.status,
    boundVehicleId: w.bound_vehicle_id,
    boundVehicleLabel: w.bound_vehicle_label,
    lastHeartbeatAt: w.last_heartbeat_at,
    lastDataAt: w.last_data_at,
    batteryLevel: w.battery_level,
    signalStrengthDbm: w.signal_strength_dbm,
    reportingIntervalSec: w.reporting_interval_sec,
  };
}
function deviceToWire(p: CreateDevicePayload | UpdateDevicePayload) {
  return {
    serial_number: p.serialNumber,
    device_type: p.deviceType,
    manufacturer: p.manufacturer,
    model: p.model,
    imei: p.imei,
    firmware_version: p.firmwareVersion,
    reporting_interval_sec: p.reportingIntervalSec,
    status: p.status,
    bound_vehicle_id: p.boundVehicleId,
  };
}

interface GroupWire {
  id: string;
  name: string;
  description: string;
  member_count: number;
  vehicle_type_filter?: VehicleGroup['vehicleTypeFilter'];
  status: VehicleGroup['status'];
  created_at: string;
}
function mapGroup(w: GroupWire): VehicleGroup {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    memberCount: w.member_count,
    vehicleTypeFilter: w.vehicle_type_filter,
    status: w.status,
    createdAt: w.created_at,
  };
}
function groupToWire(p: CreateGroupPayload | UpdateGroupPayload) {
  return {
    name: p.name,
    description: p.description,
    vehicle_type_filter: p.vehicleTypeFilter,
    status: p.status,
  };
}

// ── Fetchers (try real API → fall back to mock on network error in dev) ───────

/** GET /api/v1/fleet/vehicles (pending backend). */
function fetchVehicles(): Promise<Vehicle[]> {
  if (shouldUseMock()) return resolveMock(mockVehicles);
  return withMockFallback(
    async () => (await apiGet<VehicleWire[]>('/fleet/vehicles')).map(mapVehicle),
    () => resolveMock(mockVehicles),
  );
}

/** GET /api/v1/fleet/vehicles/{id} (pending backend). */
function fetchVehicleDetail(id: string): Promise<Vehicle | undefined> {
  if (shouldUseMock()) return resolveMock(mockVehicleDetail(id));
  return withMockFallback(
    async () => {
      const w = await apiGet<VehicleWire>(`/fleet/vehicles/${id}`);
      return mapVehicle(w);
    },
    () => resolveMock(mockVehicleDetail(id)),
  );
}

/** GET /api/v1/drivers (pending backend). */
function fetchDrivers(): Promise<Driver[]> {
  if (shouldUseMock()) return resolveMock(mockDrivers);
  return withMockFallback(
    async () => (await apiGet<DriverWire[]>('/drivers')).map(mapDriver),
    () => resolveMock(mockDrivers),
  );
}

/** GET /api/v1/drivers/{id} (pending backend). */
function fetchDriverDetail(id: string): Promise<Driver | undefined> {
  if (shouldUseMock()) return resolveMock(mockDriverDetail(id));
  return withMockFallback(
    async () => {
      const w = await apiGet<DriverWire>(`/drivers/${id}`);
      return mapDriver(w);
    },
    () => resolveMock(mockDriverDetail(id)),
  );
}

/** GET /api/v1/telemetry/devices (pending backend). */
function fetchDevices(): Promise<Device[]> {
  if (shouldUseMock()) return resolveMock(mockDevices);
  return withMockFallback(
    async () => (await apiGet<DeviceWire[]>('/telemetry/devices')).map(mapDevice),
    () => resolveMock(mockDevices),
  );
}

/** GET /api/v1/telemetry/devices/{id} (pending backend). */
function fetchDeviceDetail(id: string): Promise<Device | undefined> {
  if (shouldUseMock()) return resolveMock(mockDeviceDetail(id));
  return withMockFallback(
    async () => {
      const w = await apiGet<DeviceWire>(`/telemetry/devices/${id}`);
      return mapDevice(w);
    },
    () => resolveMock(mockDeviceDetail(id)),
  );
}

/** GET /api/v1/fleet/groups (pending backend). */
function fetchGroups(): Promise<VehicleGroup[]> {
  if (shouldUseMock()) return resolveMock(mockGroups);
  return withMockFallback(
    async () => (await apiGet<GroupWire[]>('/fleet/groups')).map(mapGroup),
    () => resolveMock(mockGroups),
  );
}

// ── LIST/DETAIL hooks ────────────────────────────────────────────────────────

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

// ── Vehicle CRUD mutations ───────────────────────────────────────────────────
// Endpoints (pending fleet-management-service):
//   POST   /fleet/vehicles
//   PATCH  /fleet/vehicles/:id   (uses apiPut; backend should treat as partial)
//   DELETE /fleet/vehicles/:id

/** Create a vehicle (POST /fleet/vehicles). */
export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation<Vehicle, Error, CreateVehiclePayload>({
    mutationFn: async (payload) => {
      const w = await apiPost<unknown, VehicleWire>('/fleet/vehicles', vehicleToWire(payload));
      return mapVehicle(w);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Update a vehicle (PUT /fleet/vehicles/:id with a partial body). */
export function useUpdateVehicle() {
  const qc = useQueryClient();
  return useMutation<Vehicle, Error, { id: string; changes: UpdateVehiclePayload }>({
    mutationFn: async ({ id, changes }) => {
      const w = await apiPut<unknown, VehicleWire>(
        `/fleet/vehicles/${id}`,
        vehicleToWire(changes),
      );
      return mapVehicle(w);
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.vehicleDetail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.vehicles() });
    },
  });
}

/** Delete a vehicle (DELETE /fleet/vehicles/:id). */
export function useDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDelete(`/fleet/vehicles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

// ── Driver CRUD + assignment mutations ───────────────────────────────────────
// Endpoints (pending driver-management-service):
//   POST   /drivers
//   PATCH  /drivers/:id
//   DELETE /drivers/:id
//   POST   /drivers/:id/assign    { vehicle_id }   (204)
//   POST   /drivers/:id/unassign                    (204)

/** Create a driver (POST /drivers). */
export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation<Driver, Error, CreateDriverPayload>({
    mutationFn: async (payload) => {
      const w = await apiPost<unknown, DriverWire>('/drivers', driverToWire(payload));
      return mapDriver(w);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Update a driver (PUT /drivers/:id). */
export function useUpdateDriver() {
  const qc = useQueryClient();
  return useMutation<Driver, Error, { id: string; changes: UpdateDriverPayload }>({
    mutationFn: async ({ id, changes }) => {
      const w = await apiPut<unknown, DriverWire>(`/drivers/${id}`, driverToWire(changes));
      return mapDriver(w);
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.driverDetail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.drivers() });
    },
  });
}

/** Delete a driver (DELETE /drivers/:id). */
export function useDeleteDriver() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDelete(`/drivers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Assign a driver to a vehicle (POST /drivers/:id/assign, 204). */
export function useAssignDriverVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, { driverId: string; vehicleId: string }>({
    mutationFn: ({ driverId, vehicleId }) =>
      apiPostNoContent(`/drivers/${driverId}/assign`, { vehicle_id: vehicleId }),
    onSuccess: (_d, { driverId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.driverDetail(driverId) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.drivers() });
    },
  });
}

/** Unassign a driver from their vehicle (POST /drivers/:id/unassign, 204). */
export function useUnassignDriverVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (driverId) => apiPostNoContent(`/drivers/${driverId}/unassign`),
    onSuccess: (_d, driverId) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.driverDetail(driverId) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.drivers() });
    },
  });
}

// ── Device CRUD + assignment mutations ───────────────────────────────────────
// Endpoints (pending device-management-service):
//   POST   /telemetry/devices
//   PATCH  /telemetry/devices/:id
//   DELETE /telemetry/devices/:id
//   POST   /telemetry/devices/:id/bind     { vehicle_id }   (204)
//   POST   /telemetry/devices/:id/unbind                      (204)

/** Create a device (POST /telemetry/devices). */
export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation<Device, Error, CreateDevicePayload>({
    mutationFn: async (payload) => {
      const w = await apiPost<unknown, DeviceWire>(
        '/telemetry/devices',
        deviceToWire(payload),
      );
      return mapDevice(w);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Update a device (PUT /telemetry/devices/:id). */
export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation<Device, Error, { id: string; changes: UpdateDevicePayload }>({
    mutationFn: async ({ id, changes }) => {
      const w = await apiPut<unknown, DeviceWire>(
        `/telemetry/devices/${id}`,
        deviceToWire(changes),
      );
      return mapDevice(w);
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.deviceDetail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.devices() });
    },
  });
}

/** Delete a device (DELETE /telemetry/devices/:id). */
export function useDeleteDevice() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDelete(`/telemetry/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Bind a device to a vehicle (POST /telemetry/devices/:id/bind, 204). */
export function useAssignDeviceVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, { deviceId: string; vehicleId: string }>({
    mutationFn: ({ deviceId, vehicleId }) =>
      apiPostNoContent(`/telemetry/devices/${deviceId}/bind`, { vehicle_id: vehicleId }),
    onSuccess: (_d, { deviceId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.deviceDetail(deviceId) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.devices() });
    },
  });
}

/** Unbind a device from its vehicle (POST /telemetry/devices/:id/unbind, 204). */
export function useUnassignDeviceVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (deviceId) => apiPostNoContent(`/telemetry/devices/${deviceId}/unbind`),
    onSuccess: (_d, deviceId) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.deviceDetail(deviceId) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.devices() });
    },
  });
}

// ── Group CRUD mutations ─────────────────────────────────────────────────────
// Endpoints (pending fleet-management-service):
//   POST   /fleet/groups
//   PATCH  /fleet/groups/:id
//   DELETE /fleet/groups/:id

/** Create a group (POST /fleet/groups). */
export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation<VehicleGroup, Error, CreateGroupPayload>({
    mutationFn: async (payload) => {
      const w = await apiPost<unknown, GroupWire>('/fleet/groups', groupToWire(payload));
      return mapGroup(w);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Update a group (PUT /fleet/groups/:id). */
export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation<VehicleGroup, Error, { id: string; changes: UpdateGroupPayload }>({
    mutationFn: async ({ id, changes }) => {
      const w = await apiPut<unknown, GroupWire>(`/fleet/groups/${id}`, groupToWire(changes));
      return mapGroup(w);
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.groupDetail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.groups() });
    },
  });
}

/** Delete a group (DELETE /fleet/groups/:id). */
export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDelete(`/fleet/groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

// ── Optimistic vehicle status action (preserved UX) ──────────────────────────
/**
 * Optimistic vehicle status action — transfer to another fleet or toggle
 * maintenance (Fleet-Management §5.1). Wraps `useUpdateVehicle` so the real
 * PATCH endpoint is used when present; falls back to an optimistic in-cache
 * update so the UI stays responsive while the request is in flight.
 */
export function useVehicleStatusAction() {
  const qc = useQueryClient();
  const update = useUpdateVehicle();
  return useMutation<
    Vehicle,
    Error,
    { id: string; status: Vehicle['status'] },
    { prev: Vehicle[] | undefined }
  >({
    mutationFn: ({ id, status }) => update.mutateAsync({ id, changes: { status } }),
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

import { api } from '@/api/client';

export interface PlatformFleet {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface PlatformDevice {
  id: string;
  imei: string;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  protocol: string;
  status: string;
  vehicleId: string | null;
  fleetId: string | null;
  fleetName: string | null;
  fleetCode: string | null;
}

export interface PlatformAssignment {
  deviceId: string;
  vehicleId: string;
  fleetId: string;
  fleetName: string;
  createdVehicle: boolean;
}

export async function listTenantFleets(tenantId: string): Promise<PlatformFleet[]> {
  const { data } = await api.get<{ data: PlatformFleet[] }>(`/platform/tenants/${tenantId}/fleets`);
  return data.data;
}

export async function createTenantFleet(
  tenantId: string,
  body: { name: string; code: string; description?: string },
): Promise<PlatformFleet> {
  const { data } = await api.post<{ data: PlatformFleet }>(
    `/platform/tenants/${tenantId}/fleets`,
    body,
  );
  return data.data;
}

export async function listTenantDevices(tenantId: string): Promise<PlatformDevice[]> {
  const { data } = await api.get<{ data: PlatformDevice[] }>(
    `/platform/tenants/${tenantId}/devices`,
  );
  return data.data;
}

export interface ImeiLookup {
  imei: string;
  state: 'ASSIGNED' | 'INBOX' | 'UNKNOWN';
  tenantId: string | null;
  deviceId: string | null;
  protocol: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  seenCount: number;
}

export interface InboxDevice {
  imei: string;
  protocol: string;
  manufacturer: string | null;
  model: string | null;
  seenCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ClaimResult {
  deviceId: string;
  created: boolean;
  assignment: PlatformAssignment | null;
}

export async function lookupImei(imei: string): Promise<ImeiLookup> {
  const { data } = await api.get<{ data: ImeiLookup }>(
    `/platform/devices/by-imei/${encodeURIComponent(imei)}`,
  );
  return data.data;
}

export async function listInbox(): Promise<InboxDevice[]> {
  const { data } = await api.get<{ data: InboxDevice[] }>('/platform/devices/inbox');
  return data.data;
}

export async function claimDevice(
  tenantId: string,
  body: { imei: string; fleetId?: string },
): Promise<ClaimResult> {
  const { data } = await api.post<{ data: ClaimResult }>(
    `/platform/tenants/${tenantId}/devices/claim`,
    body,
  );
  return data.data;
}

export interface BulkAssignResult {
  fleetId: string;
  assigned: Array<{
    imei: string;
    deviceId: string;
    created: boolean;
    assignment: PlatformAssignment | null;
  }>;
  failed: Array<{ imei: string; message: string }>;
}

export async function assignImeisToFleet(
  tenantId: string,
  body: { fleetId: string; imeis: string[] },
): Promise<BulkAssignResult> {
  const { data } = await api.post<{ data: BulkAssignResult }>(
    `/platform/tenants/${tenantId}/devices/assign`,
    body,
  );
  return data.data;
}

export interface ClearFleetResult {
  cleared: Array<{ deviceId: string; cleared: boolean }>;
  failed: Array<{ deviceId: string; message: string }>;
}

export async function clearDevicesFromFleet(
  tenantId: string,
  deviceIds: string[],
): Promise<ClearFleetResult> {
  const { data } = await api.post<{ data: ClearFleetResult }>(
    `/platform/tenants/${tenantId}/devices/clear-fleet`,
    { deviceIds },
  );
  return data.data;
}

export async function assignDeviceToFleet(
  tenantId: string,
  deviceId: string,
  fleetId: string,
): Promise<PlatformAssignment> {
  const { data } = await api.put<{ data: PlatformAssignment }>(
    `/platform/tenants/${tenantId}/devices/${deviceId}/fleet`,
    { fleetId },
  );
  return data.data;
}

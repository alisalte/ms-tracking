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

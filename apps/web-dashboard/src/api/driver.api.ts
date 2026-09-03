/**
 * Driver registry API — REAL fleet-service (`/api/v1/fleet/drivers`).
 *
 *   GET    /fleet/drivers                         (?cursor&limit&status) → Page<Driver>
 *   POST   /fleet/drivers                         snake_case create DTO
 *   GET    /fleet/drivers/:id
 *   PUT    /fleet/drivers/:id                     snake_case update DTO
 *   POST   /fleet/drivers/:id/deactivate          204
 *   POST   /fleet/drivers/:id/assign-vehicle      { vehicle_id }
 *   POST   /fleet/drivers/:id/unassign-vehicle    204
 *
 * The wire from Nest (class JSON) is camelCase; writes use the Zod DTO's
 * snake_case. Cursor pagination is followed to exhaustion like the other
 * asset registries so the DataTable stays a single in-memory list.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { DriverImportDraft } from '@/lib/asset-import';
import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import { MAX_PAGE_SIZE } from '@/lib/pagination';
import { mockDrivers } from '@/mock/driver-data';
import type { Page } from '@/types/api.types';
import type {
  AssetImportFailure,
  AssetImportResult,
  CreateDriverPayload,
  Driver,
  DriverStatus,
  UpdateDriverPayload,
  Vehicle,
} from '@/types/asset.types';
import { apiGet, apiGetRaw, apiPost, apiPostNoContent, apiPut } from './client';
import { getApiErrorMessage } from './errors';
import { queryKeys } from './query-keys';

const PAGE_SIZE = MAX_PAGE_SIZE;
const MAX_PAGES = 50;

function asStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s.length ? s : null;
}

function asStatus(v: unknown): DriverStatus {
  const s = String(v ?? 'ACTIVE').toUpperCase();
  if (s === 'INACTIVE' || s === 'SUSPENDED' || s === 'TERMINATED') return s;
  return 'ACTIVE';
}

/** Map fleet-service Driver JSON (camelCase or snake_case) to the UI type. */
export function mapDriver(raw: Record<string, unknown>): Driver {
  return {
    id: String(raw.id ?? ''),
    tenantId: String(raw.tenantId ?? raw.tenant_id ?? ''),
    employeeId: asStr(raw.employeeId ?? raw.employee_id),
    firstName: String(raw.firstName ?? raw.first_name ?? ''),
    lastName: String(raw.lastName ?? raw.last_name ?? ''),
    email: asStr(raw.email),
    phone: asStr(raw.phone),
    licenseNumber: String(raw.licenseNumber ?? raw.license_number ?? ''),
    licenseClass: asStr(raw.licenseClass ?? raw.license_class),
    licenseIssued: asStr(raw.licenseIssued ?? raw.license_issued),
    licenseExpires: asStr(raw.licenseExpires ?? raw.license_expires),
    licenseCountry: asStr(raw.licenseCountry ?? raw.license_country),
    status: asStatus(raw.status),
    assignedVehicleId: asStr(raw.assignedVehicleId ?? raw.assigned_vehicle_id),
    assignedAt: asStr(raw.assignedAt ?? raw.assigned_at),
    version: Number(raw.version ?? 1),
  };
}

export function driverFullName(d: Pick<Driver, 'firstName' | 'lastName'>): string {
  return `${d.firstName} ${d.lastName}`.trim();
}

/** HTML date (YYYY-MM-DD) → ISO datetime the backend Zod `.datetime()` accepts. */
export function dateInputToDatetime(value: string | undefined | null): string | null {
  const t = (value ?? '').trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T00:00:00.000Z`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO / date string → YYYY-MM-DD for `<input type="date">`. */
export function datetimeToDateInput(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function toWire(payload: CreateDriverPayload | UpdateDriverPayload): Record<string, unknown> {
  const issued = dateInputToDatetime(payload.licenseIssued);
  const expires = dateInputToDatetime(payload.licenseExpires);
  return {
    ...(payload.employeeId !== undefined ? { employee_id: payload.employeeId.trim() || null } : {}),
    ...(payload.firstName !== undefined ? { first_name: payload.firstName } : {}),
    ...(payload.lastName !== undefined ? { last_name: payload.lastName } : {}),
    ...(payload.email !== undefined ? { email: payload.email.trim() || null } : {}),
    ...(payload.phone !== undefined ? { phone: payload.phone.trim() || null } : {}),
    ...(payload.licenseNumber !== undefined ? { license_number: payload.licenseNumber } : {}),
    ...(payload.licenseClass !== undefined
      ? { license_class: payload.licenseClass.trim() || null }
      : {}),
    ...(payload.licenseIssued !== undefined ? { license_issued: issued } : {}),
    ...(payload.licenseExpires !== undefined ? { license_expires: expires } : {}),
    ...(payload.licenseCountry !== undefined
      ? { license_country: payload.licenseCountry.trim() || null }
      : {}),
  };
}

async function fetchAllDrivers(status?: DriverStatus): Promise<Driver[]> {
  const out: Driver[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await apiGetRaw<Page<Record<string, unknown>>>('/fleet/drivers', {
      limit: PAGE_SIZE,
      cursor,
      ...(status ? { status } : {}),
    });
    out.push(...result.data.map(mapDriver));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return out;
}

function fetchDrivers(): Promise<Driver[]> {
  if (shouldUseMock()) return resolveMock(mockDrivers());
  return withMockFallback(
    () => fetchAllDrivers(),
    () => resolveMock(mockDrivers()),
  );
}

function fetchDriverDetail(id: string): Promise<Driver | undefined> {
  if (shouldUseMock()) return resolveMock(mockDrivers().find((d) => d.id === id));
  return withMockFallback(
    async () => mapDriver((await apiGet<Record<string, unknown>>(`/fleet/drivers/${id}`)) ?? {}),
    async () => undefined,
  );
}

export function useDrivers(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.assets.drivers(),
    queryFn: fetchDrivers,
    enabled: options?.enabled ?? true,
  });
}

export function useDriverDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.assets.driverDetail(id) : ['assets', 'driver', 'none'],
    queryFn: () => fetchDriverDetail(id as string),
    enabled: Boolean(id),
  });
}

async function syncAssignment(id: string, vehicleId: string | null | undefined): Promise<void> {
  if (vehicleId === undefined) return;
  if (vehicleId) {
    await apiPost<{ vehicle_id: string }, { id: string }>(`/fleet/drivers/${id}/assign-vehicle`, {
      vehicle_id: vehicleId,
    });
  } else {
    await apiPostNoContent(`/fleet/drivers/${id}/unassign-vehicle`);
  }
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, CreateDriverPayload>({
    mutationFn: async (payload) => {
      const created = await apiPost<Record<string, unknown>, { id: string }>(
        '/fleet/drivers',
        toWire(payload),
      );
      if (payload.assignedVehicleId) {
        await syncAssignment(created.id, payload.assignedVehicleId);
      }
      return created;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

export function useUpdateDriver() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; changes: UpdateDriverPayload }>({
    mutationFn: async ({ id, changes }) => {
      await apiPut<Record<string, unknown>, { id: string }>(
        `/fleet/drivers/${id}`,
        toWire(changes),
      );
      if (changes.assignedVehicleId !== undefined) {
        await syncAssignment(id, changes.assignedVehicleId);
      }
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.driverDetail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.all });
    },
  });
}

export function useDeactivateDriver() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiPostNoContent(`/fleet/drivers/${id}/deactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

export function useAssignDriverVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, { driverId: string; vehicleId: string }>({
    mutationFn: ({ driverId, vehicleId }) => syncAssignment(driverId, vehicleId),
    onSuccess: (_d, { driverId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.driverDetail(driverId) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.all });
    },
  });
}

export function useUnassignDriverVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (driverId) => syncAssignment(driverId, null),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/** Create drivers one-by-one (fleet-service has no bulk import). Partial success. */
export function useImportDrivers() {
  const qc = useQueryClient();
  return useMutation<
    AssetImportResult<Driver>,
    Error,
    { rows: DriverImportDraft[]; vehicles: Vehicle[] }
  >({
    mutationFn: async ({ rows, vehicles }) => {
      const byCode = new Map(vehicles.map((v) => [v.code.toLowerCase(), v]));
      const created: Driver[] = [];
      const failed: AssetImportFailure[] = [];
      const warnings: AssetImportFailure[] = [];
      for (const row of rows) {
        try {
          const record = await apiPost<Record<string, unknown>, Record<string, unknown>>(
            '/fleet/drivers',
            toWire({
              firstName: row.firstName,
              lastName: row.lastName,
              licenseNumber: row.licenseNumber,
              employeeId: row.employeeId,
              email: row.email,
              phone: row.phone,
              licenseClass: row.licenseClass,
              licenseIssued: row.licenseIssued,
              licenseExpires: row.licenseExpires,
              licenseCountry: row.licenseCountry,
            }),
          );
          const mapped = mapDriver(record);
          const id = mapped.id || String(record.id ?? '');
          if (row.vehicleCode) {
            const vehicle = byCode.get(row.vehicleCode.toLowerCase());
            if (!vehicle) {
              warnings.push({
                row: row.row,
                error: `Vehicle code "${row.vehicleCode}" was not found`,
              });
            } else if (id) {
              try {
                await syncAssignment(id, vehicle.id);
              } catch (err) {
                warnings.push({ row: row.row, error: getApiErrorMessage(err) });
              }
            }
          }
          created.push(mapped);
        } catch (err) {
          failed.push({ row: row.row, error: getApiErrorMessage(err) });
        }
      }
      return { created, failed, warnings };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.assets.all }),
  });
}

/**
 * Driver registry API — REAL fleet-service (`/api/v1/fleet/drivers`).
 *
 *   GET    /fleet/drivers                         (?cursor&limit&status) → Page<Driver>
 *   POST   /fleet/drivers                         snake_case create DTO
 *   GET    /fleet/drivers/:id
 *   PUT    /fleet/drivers/:id                     snake_case update DTO
 *   POST   /fleet/drivers/:id/deactivate          204
 *   POST   /fleet/drivers/:id/assign-vehicle      { vehicle_id, shift_no? }
 *   POST   /fleet/drivers/:id/unassign-vehicle    204
 *   GET    /fleet/drivers/:id/assignments         (?from&to ISO) → assignment history
 *   GET    /fleet/vehicles/:id/behavior-score     vehicle-centric behavior score + per-driver split
 *   GET    /fleet/vehicles/:id/behavior-events    behavior events recorded on the vehicle
 *
 * The wire from Nest (class JSON) is camelCase; writes use the Zod DTO's
 * snake_case. Cursor pagination is followed to exhaustion like the other
 * asset registries so the DataTable stays a single in-memory list.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { DriverImportDraft } from '@/lib/asset-import';
import { fixShamsiYmd } from '@/lib/jalali';
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

function asShift(v: unknown): number | null {
  const n = Number(v);
  return v != null && Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
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
    assignedShift: asShift(raw.assignedShift ?? raw.assigned_shift),
    assignedAt: asStr(raw.assignedAt ?? raw.assigned_at),
    version: Number(raw.version ?? 1),
  };
}

export function driverFullName(d: Pick<Driver, 'firstName' | 'lastName'>): string {
  return `${d.firstName} ${d.lastName}`.trim();
}

/** One driver↔vehicle assignment interval from fleet-service. */
export interface DriverAssignmentInterval {
  id: string;
  driverId: string;
  vehicleId: string;
  startedAt: string;
  endedAt: string | null;
  /** Shift the driver covered on the vehicle; null = any shift. */
  shiftNo: number | null;
  changedBy: string | null;
  isCurrent: boolean;
}

export function mapDriverAssignment(raw: Record<string, unknown>): DriverAssignmentInterval {
  const endedAt = asStr(raw.endedAt ?? raw.ended_at);
  return {
    id: String(raw.id ?? ''),
    driverId: String(raw.driverId ?? raw.driver_id ?? ''),
    vehicleId: String(raw.vehicleId ?? raw.vehicle_id ?? ''),
    startedAt: asStr(raw.startedAt ?? raw.started_at) ?? '',
    endedAt,
    shiftNo: asShift(raw.shiftNo ?? raw.shift_no),
    changedBy: asStr(raw.changedBy ?? raw.changed_by),
    isCurrent: endedAt == null || Boolean(raw.isCurrent ?? raw.is_current),
  };
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
  // A Shamsi date saved as Gregorian is corrected when the record is opened for editing.
  return fixShamsiYmd(value).slice(0, 10);
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

/** Active drivers for captions / assignment joins (alarms, notifications). */
export function fetchDrivers(): Promise<Driver[]> {
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

async function fetchDriverAssignments(id: string): Promise<DriverAssignmentInterval[]> {
  if (shouldUseMock()) return resolveMock([]);
  return withMockFallback(
    async () => {
      const rows = await apiGet<Record<string, unknown>[]>(`/fleet/drivers/${id}/assignments`);
      return (rows ?? []).map(mapDriverAssignment);
    },
    async () => [],
  );
}

export function useDriverAssignments(id: string | null) {
  return useQuery({
    queryKey: id
      ? queryKeys.assets.driverAssignments(id)
      : ['assets', 'driver', 'assignments', 'none'],
    queryFn: () => fetchDriverAssignments(id as string),
    enabled: Boolean(id),
  });
}

export interface DriverBehaviorScore {
  score: number | null;
  periodStart: string;
  periodEnd: string;
  harshBrakeCount: number;
  rapidAccelCount: number;
  speedViolationCount: number;
  excessiveIdleCount: number;
  calculatedAt: string | null;
  previousScore: number | null;
  delta: number | null;
  needsAttention: boolean;
  deductions: {
    harshBrake: number;
    rapidAccel: number;
    speedViolation: number;
    excessiveIdle: number;
  } | null;
}

export interface DriverBehaviorEvent {
  id: string;
  type: string;
  severity: string;
  vehicleId: string;
  /** Driver assigned at `raisedAt`; null when nobody was assigned to the vehicle. */
  driverId: string | null;
  raisedAt: string;
  sourceAlarmId: string | null;
}

function mapBehaviorScore(
  raw: Record<string, unknown> | null | undefined,
): DriverBehaviorScore | null {
  if (!raw) return null;
  return {
    score: raw.score == null ? null : Number(raw.score),
    periodStart: asStr(raw.periodStart ?? raw.period_start) ?? '',
    periodEnd: asStr(raw.periodEnd ?? raw.period_end) ?? '',
    harshBrakeCount: Number(raw.harshBrakeCount ?? raw.harsh_brake_count ?? 0),
    rapidAccelCount: Number(raw.rapidAccelCount ?? raw.rapid_accel_count ?? 0),
    speedViolationCount: Number(raw.speedViolationCount ?? raw.speed_violation_count ?? 0),
    excessiveIdleCount: Number(raw.excessiveIdleCount ?? raw.excessive_idle_count ?? 0),
    calculatedAt: asStr(raw.calculatedAt ?? raw.calculated_at),
    previousScore:
      raw.previousScore == null && raw.previous_score == null
        ? null
        : Number(raw.previousScore ?? raw.previous_score),
    delta: raw.delta == null ? null : Number(raw.delta),
    needsAttention: Boolean(raw.needsAttention ?? raw.needs_attention),
    deductions: (raw.deductions as DriverBehaviorScore['deductions']) ?? null,
  };
}

function mapBehaviorEvent(raw: Record<string, unknown>): DriverBehaviorEvent {
  return {
    id: String(raw.id ?? ''),
    type: String(raw.type ?? ''),
    severity: String(raw.severity ?? ''),
    vehicleId: String(raw.vehicleId ?? raw.vehicle_id ?? ''),
    driverId: asStr(raw.driverId ?? raw.driver_id),
    raisedAt: asStr(raw.raisedAt ?? raw.raised_at) ?? '',
    sourceAlarmId: asStr(raw.sourceAlarmId ?? raw.source_alarm_id),
  };
}

async function fetchDriverBehaviorScore(id: string): Promise<DriverBehaviorScore | null> {
  if (shouldUseMock()) return resolveMock(null);
  return withMockFallback(
    async () =>
      mapBehaviorScore(
        await apiGet<Record<string, unknown> | null>(`/fleet/drivers/${id}/behavior-score`),
      ),
    async () => null,
  );
}

async function fetchDriverBehaviorEvents(id: string): Promise<DriverBehaviorEvent[]> {
  if (shouldUseMock()) return resolveMock([]);
  return withMockFallback(
    async () => {
      const rows = await apiGet<Record<string, unknown>[]>(`/fleet/drivers/${id}/behavior-events`);
      return (rows ?? []).map(mapBehaviorEvent);
    },
    async () => [],
  );
}

export function useDriverBehaviorScore(id: string | null) {
  return useQuery({
    queryKey: id
      ? queryKeys.assets.driverBehaviorScore(id)
      : ['assets', 'driver', 'behavior-score', 'none'],
    queryFn: () => fetchDriverBehaviorScore(id as string),
    enabled: Boolean(id),
  });
}

export function useDriverBehaviorEvents(id: string | null) {
  return useQuery({
    queryKey: id
      ? queryKeys.assets.driverBehaviorEvents(id)
      : ['assets', 'driver', 'behavior-events', 'none'],
    queryFn: () => fetchDriverBehaviorEvents(id as string),
    enabled: Boolean(id),
  });
}

export interface DriverBehaviorRankingRow {
  rank: number;
  driverId: string;
  firstName: string;
  lastName: string;
  status: string;
  score: number;
  harshBrakeCount: number;
  rapidAccelCount: number;
  speedViolationCount: number;
  excessiveIdleCount: number;
  needsAttention: boolean;
}

function mapRankingRow(raw: Record<string, unknown>): DriverBehaviorRankingRow {
  return {
    rank: Number(raw.rank ?? 0),
    driverId: String(raw.driverId ?? raw.driver_id ?? ''),
    firstName: String(raw.firstName ?? raw.first_name ?? ''),
    lastName: String(raw.lastName ?? raw.last_name ?? ''),
    status: String(raw.status ?? 'ACTIVE'),
    score: Number(raw.score ?? 0),
    harshBrakeCount: Number(raw.harshBrakeCount ?? raw.harsh_brake_count ?? 0),
    rapidAccelCount: Number(raw.rapidAccelCount ?? raw.rapid_accel_count ?? 0),
    speedViolationCount: Number(raw.speedViolationCount ?? raw.speed_violation_count ?? 0),
    excessiveIdleCount: Number(raw.excessiveIdleCount ?? raw.excessive_idle_count ?? 0),
    needsAttention: Boolean(raw.needsAttention ?? raw.needs_attention),
  };
}

async function fetchDriverBehaviorRanking(): Promise<DriverBehaviorRankingRow[]> {
  if (shouldUseMock()) return resolveMock([]);
  return withMockFallback(
    async () => {
      const body = await apiGetRaw<{ data: Record<string, unknown>[] }>(
        '/fleet/drivers/behavior-ranking',
      );
      return (body.data ?? []).map(mapRankingRow);
    },
    async () => [],
  );
}

export function useDriverBehaviorRanking(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.assets.driverBehaviorRanking(),
    queryFn: fetchDriverBehaviorRanking,
    enabled: options?.enabled ?? true,
  });
}

/** One driver's share of the behavior events recorded on a vehicle. */
export interface VehicleBehaviorDriver {
  driverId: string;
  firstName: string;
  lastName: string;
  score: number;
  eventCount: number;
  harshBrakeCount: number;
  rapidAccelCount: number;
  speedViolationCount: number;
  excessiveIdleCount: number;
}

/** Vehicle-centric behavior: scored over every event the car raised, split per driver. */
export interface VehicleBehavior {
  vehicleId: string;
  periodStart: string;
  periodEnd: string;
  score: number;
  harshBrakeCount: number;
  rapidAccelCount: number;
  speedViolationCount: number;
  excessiveIdleCount: number;
  eventCount: number;
  /** Events raised while no driver was assigned to the vehicle. */
  unattributedCount: number;
  previousScore: number | null;
  delta: number | null;
  needsAttention: boolean;
  drivers: VehicleBehaviorDriver[];
}

function mapVehicleBehaviorDriver(raw: Record<string, unknown>): VehicleBehaviorDriver {
  return {
    driverId: String(raw.driverId ?? raw.driver_id ?? ''),
    firstName: String(raw.firstName ?? raw.first_name ?? ''),
    lastName: String(raw.lastName ?? raw.last_name ?? ''),
    score: Number(raw.score ?? 0),
    eventCount: Number(raw.eventCount ?? raw.event_count ?? 0),
    harshBrakeCount: Number(raw.harshBrake ?? raw.harshBrakeCount ?? 0),
    rapidAccelCount: Number(raw.rapidAccel ?? raw.rapidAccelCount ?? 0),
    speedViolationCount: Number(raw.speedViolation ?? raw.speedViolationCount ?? 0),
    excessiveIdleCount: Number(raw.excessiveIdle ?? raw.excessiveIdleCount ?? 0),
  };
}

function mapVehicleBehavior(
  raw: Record<string, unknown> | null | undefined,
): VehicleBehavior | null {
  if (!raw || raw.score == null) return null;
  const drivers = Array.isArray(raw.drivers) ? (raw.drivers as Record<string, unknown>[]) : [];
  return {
    vehicleId: String(raw.vehicleId ?? raw.vehicle_id ?? ''),
    periodStart: asStr(raw.periodStart ?? raw.period_start) ?? '',
    periodEnd: asStr(raw.periodEnd ?? raw.period_end) ?? '',
    score: Number(raw.score),
    harshBrakeCount: Number(raw.harshBrake ?? raw.harshBrakeCount ?? 0),
    rapidAccelCount: Number(raw.rapidAccel ?? raw.rapidAccelCount ?? 0),
    speedViolationCount: Number(raw.speedViolation ?? raw.speedViolationCount ?? 0),
    excessiveIdleCount: Number(raw.excessiveIdle ?? raw.excessiveIdleCount ?? 0),
    eventCount: Number(raw.eventCount ?? raw.event_count ?? 0),
    unattributedCount: Number(raw.unattributedCount ?? raw.unattributed_count ?? 0),
    previousScore: raw.previousScore == null ? null : Number(raw.previousScore),
    delta: raw.delta == null ? null : Number(raw.delta),
    needsAttention: Boolean(raw.needsAttention ?? raw.needs_attention),
    drivers: drivers.map(mapVehicleBehaviorDriver),
  };
}

async function fetchVehicleBehavior(id: string): Promise<VehicleBehavior | null> {
  if (shouldUseMock()) return resolveMock(null);
  return withMockFallback(
    async () =>
      mapVehicleBehavior(
        await apiGet<Record<string, unknown> | null>(`/fleet/vehicles/${id}/behavior-score`),
      ),
    async () => null,
  );
}

async function fetchVehicleBehaviorEvents(id: string): Promise<DriverBehaviorEvent[]> {
  if (shouldUseMock()) return resolveMock([]);
  return withMockFallback(
    async () => {
      const rows = await apiGet<Record<string, unknown>[]>(`/fleet/vehicles/${id}/behavior-events`);
      return (rows ?? []).map(mapBehaviorEvent);
    },
    async () => [],
  );
}

export function useVehicleBehavior(id: string | null) {
  return useQuery({
    queryKey: id
      ? queryKeys.assets.vehicleBehavior(id)
      : ['assets', 'vehicle', 'behavior-score', 'none'],
    queryFn: () => fetchVehicleBehavior(id as string),
    enabled: Boolean(id),
  });
}

export function useVehicleBehaviorEvents(id: string | null) {
  return useQuery({
    queryKey: id
      ? queryKeys.assets.vehicleBehaviorEvents(id)
      : ['assets', 'vehicle', 'behavior-events', 'none'],
    queryFn: () => fetchVehicleBehaviorEvents(id as string),
    enabled: Boolean(id),
  });
}

async function syncAssignment(
  id: string,
  vehicleId: string | null | undefined,
  shiftNo: number | null = null,
): Promise<void> {
  if (vehicleId === undefined) return;
  if (vehicleId) {
    await apiPost<{ vehicle_id: string; shift_no: number | null }, { id: string }>(
      `/fleet/drivers/${id}/assign-vehicle`,
      { vehicle_id: vehicleId, shift_no: shiftNo },
    );
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
        await syncAssignment(created.id, payload.assignedVehicleId, payload.assignedShift ?? null);
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
        await syncAssignment(id, changes.assignedVehicleId, changes.assignedShift ?? null);
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
  return useMutation<void, Error, { driverId: string; vehicleId: string; shiftNo?: number | null }>(
    {
      mutationFn: ({ driverId, vehicleId, shiftNo }) =>
        syncAssignment(driverId, vehicleId, shiftNo ?? null),
      onSuccess: (_d, { driverId }) => {
        qc.invalidateQueries({ queryKey: queryKeys.assets.driverDetail(driverId) });
        qc.invalidateQueries({ queryKey: queryKeys.assets.driverAssignments(driverId) });
        qc.invalidateQueries({ queryKey: queryKeys.assets.all });
      },
    },
  );
}

export function useUnassignDriverVehicle() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (driverId) => syncAssignment(driverId, null),
    onSuccess: (_d, driverId) => {
      qc.invalidateQueries({ queryKey: queryKeys.assets.driverDetail(driverId) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.driverAssignments(driverId) });
      qc.invalidateQueries({ queryKey: queryKeys.assets.all });
    },
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
                await syncAssignment(id, vehicle.id, row.shiftNo ?? null);
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

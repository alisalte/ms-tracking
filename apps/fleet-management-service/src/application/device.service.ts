import {
  type Knex,
  TenantQuotaDeniedError,
  assertTenantResourceQuota,
  withTenantContext,
} from '@fleetvision/persistence-knex';
import type { Page } from '@fleetvision/shared-kernel';
/**
 * DeviceService — device use-cases + the cross-tenant IMEI resolution the
 * device-gateway relies on (Sprint C §8, §18, §19).
 *
 * - Management CRUD is tenant-scoped + audited. DELETE = DECOMMISSION (archive),
 *   never a hard delete — telemetry history in tracking.vehicle_positions must
 *   remain queryable (§27). Disabling (SUSPENDED) rejects new connections.
 * - `resolve(imei)` is the gateway's trusted lookup: global IMEI → identity, with
 *   the owning tenant's active-status checked. It is the source of truth for the
 *   device-gateway's auth-resolver L3 (cached upward; never per-packet).
 * - `enroll(imei)` is first-packet auto-provision: create the device (and a
 *   bound vehicle) in the API-key tenant so an SMS-configured unit appears on
 *   the map without a prior dashboard step. Idempotent on IMEI.
 */
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type {
  DeviceRecord,
  DeviceResolution,
  DeviceRole,
  DeviceStatus,
  Protocol,
} from '../domain/device/device-types.js';
import type { RegistryInvalidationPublisher } from '../infrastructure/cache/registry-invalidation-publisher.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import {
  type DeviceListFilters,
  DeviceRepository,
} from '../infrastructure/persistence/device.repository.js';
import type { FleetRepository } from '../infrastructure/persistence/fleet.repository.js';
import type {
  VehicleRepository,
  VehicleRow,
} from '../infrastructure/persistence/vehicle.repository.js';
import type { BindingService } from './binding.service.js';
import { indexByLookup, lookupKeys, matchIndexed } from './code-lookup.js';
import { mapUniqueViolation } from './db-errors.js';
import type { ImportResult } from './import-result.js';
import type { ActorContext } from './service-context.js';
import {
  type CreateDeviceInput,
  type EnrollDeviceInput,
  type UpdateDeviceInput,
  importDeviceRowSchema,
} from './validation/schemas.js';

export class DeviceService {
  constructor(
    private readonly knex: Knex,
    private readonly devices: DeviceRepository,
    private readonly audit: AuditRepository,
    /** Sprint D §11 — push-based gateway cache invalidation (best-effort). */
    private readonly invalidation: RegistryInvalidationPublisher | null = null,
    /** Optional — used by spreadsheet import to resolve `vehicleCode`. */
    private readonly vehicles: VehicleRepository | null = null,
    /** Optional — used by spreadsheet import to bind after create. */
    private readonly bindings: BindingService | null = null,
    /** Optional — used by first-packet enroll to place the auto-created vehicle. */
    private readonly fleets: FleetRepository | null = null,
  ) {}

  // --- Management API -------------------------------------------------------

  public async create(ctx: ActorContext, input: CreateDeviceInput): Promise<DeviceRecord> {
    try {
      return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
        await assertTenantResourceQuota(trx, ctx.tenantId, 'devices');
        const row = await this.devices.create(trx, ctx.tenantId, {
          imei: input.imei, // already normalized by the zod schema
          serialNumber: input.serialNumber ?? null,
          manufacturer: input.manufacturer ?? null,
          model: input.model ?? null,
          protocol: input.protocol,
          status: input.status ?? 'ACTIVE',
        });
        const record = DeviceRepository.toRecord(row);
        await this.audit.append(trx, this.entry(ctx, 'device.created', record.id, null, record));
        return record;
      });
    } catch (err) {
      if (err instanceof TenantQuotaDeniedError) throw new ForbiddenException(err.message);
      throw mapUniqueViolation(err);
    }
  }

  /**
   * Spreadsheet import: create each device independently; optional `vehicleCode`
   * binds after a successful create (TRACKER; primary unless the slot is taken).
   */
  public async importMany(
    ctx: ActorContext,
    rows: ReadonlyArray<Record<string, unknown>>,
  ): Promise<ImportResult<DeviceRecord>> {
    const created: DeviceRecord[] = [];
    const failed: ImportResult<DeviceRecord>['failed'] = [];
    const warnings: ImportResult<DeviceRecord>['warnings'] = [];
    const vehicleCache = new Map<string, VehicleRow | null>();

    for (let i = 0; i < rows.length; i += 1) {
      const raw = rows[i] ?? {};
      const rowNum = Number.isFinite(Number(raw.row)) ? Number(raw.row) : i + 2;
      try {
        const parsed = importDeviceRowSchema.safeParse(raw);
        if (!parsed.success) {
          failed.push({
            row: rowNum,
            error: parsed.error.issues[0]?.message ?? 'Invalid device row.',
          });
          continue;
        }
        const input = parsed.data;
        let vehicle: VehicleRow | null = null;
        if (input.vehicleCode) {
          const cacheKey = input.vehicleCode.toLowerCase();
          if (!vehicleCache.has(cacheKey)) {
            vehicleCache.set(cacheKey, await this.resolveVehicle(ctx.tenantId, input.vehicleCode));
          }
          vehicle = vehicleCache.get(cacheKey) ?? null;
          if (!vehicle) {
            failed.push({
              row: rowNum,
              error: `Vehicle '${input.vehicleCode}' was not found.`,
            });
            continue;
          }
          if (vehicle.status === 'ARCHIVED') {
            failed.push({
              row: rowNum,
              error: `Vehicle '${input.vehicleCode}' is archived.`,
            });
            continue;
          }
        }
        const record = await this.create(ctx, {
          imei: input.imei,
          serialNumber: input.serialNumber,
          manufacturer: input.manufacturer,
          model: input.model,
          protocol: input.protocol,
        });
        created.push(record);
        if (vehicle && this.bindings) {
          try {
            await this.bindImported(ctx, vehicle.id, record.id);
          } catch (err) {
            warnings.push({
              row: rowNum,
              error: `Device created but not bound: ${importErrorMessage(err)}`,
            });
          }
        }
      } catch (err) {
        failed.push({ row: rowNum, error: importErrorMessage(err) });
      }
    }
    return { created, failed, warnings };
  }

  public async get(ctx: ActorContext, id: string): Promise<DeviceRecord> {
    const row = await this.devices.findById(ctx.tenantId, id);
    if (!row) throw new NotFoundException('Device not found.');
    return DeviceRepository.toRecord(row);
  }

  public async list(
    ctx: ActorContext,
    filters: DeviceListFilters,
    opts: { cursor?: string; limit: number },
  ): Promise<Page<DeviceRecord>> {
    const page = await this.devices.list(ctx.tenantId, filters, opts);
    return { data: page.data.map(DeviceRepository.toRecord), nextCursor: page.nextCursor };
  }

  public async update(
    ctx: ActorContext,
    id: string,
    input: UpdateDeviceInput,
  ): Promise<DeviceRecord> {
    const current = await this.devices.findById(ctx.tenantId, id);
    if (!current) throw new NotFoundException('Device not found.');
    return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const row = await this.devices.update(trx, ctx.tenantId, id, input, current.version);
      if (!row) throw new ConflictException('Device was modified by another request.');
      const record = DeviceRepository.toRecord(row);
      await this.audit.append(trx, this.entry(ctx, 'device.updated', id, current, record));
      // Sprint D §11 — a protocol/IMEI change alters what the gateway must know.
      if (record.protocol !== DeviceRepository.toRecord(current).protocol) {
        this.invalidation?.invalidate(record.imei, 'device.updated', ctx.tenantId);
      }
      return record;
    });
  }

  /**
   * Lifecycle status transition (e.g. ACTIVE→SUSPENDED to disable, →DECOMMISSIONED
   * for DELETE). Audited. The gateway's auth cache is invalidated immediately
   * (Sprint D §11) — a just-disabled device is rejected on its next frame, not
   * after the Sprint C TTL bound.
   */
  public async setStatus(
    ctx: ActorContext,
    id: string,
    status: DeviceStatus,
    action: string,
  ): Promise<DeviceRecord> {
    const current = await this.devices.findById(ctx.tenantId, id);
    if (!current) throw new NotFoundException('Device not found.');
    return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const row = await this.devices.setStatus(trx, ctx.tenantId, id, status, current.version);
      if (!row) throw new ConflictException('Device was modified by another request.');
      const record = DeviceRepository.toRecord(row);
      await this.audit.append(trx, this.entry(ctx, action, id, current, record));
      this.invalidation?.invalidate(record.imei, 'device.status-changed', ctx.tenantId);
      return record;
    });
  }

  // --- Gateway resolution (cross-tenant, API-key-only endpoint) -------------

  /** Global IMEI → trusted device identity (+ owning tenant active flag). */
  public async resolve(imei: string): Promise<DeviceResolution> {
    return this.devices.resolveByImei(imei);
  }

  /**
   * First-packet auto-provision for the API-key tenant. Idempotent: an existing
   * IMEI is returned as-is (and unbound units in this tenant get a vehicle).
   * Duplicate-IMEI races fall back to resolve.
   */
  public async enroll(ctx: ActorContext, input: EnrollDeviceInput): Promise<DeviceResolution> {
    const existing = await this.resolve(input.imei);
    if (existing.found) {
      if (existing.device.tenantId === ctx.tenantId && !existing.device.vehicleId) {
        await this.autoProvisionVehicle(ctx, existing.device.deviceId, input);
        return this.resolve(input.imei);
      }
      return existing;
    }

    try {
      const device = await this.create(ctx, {
        imei: input.imei,
        serialNumber: input.imei,
        manufacturer: input.manufacturer ?? manufacturerFor(input.protocol),
        model: input.model,
        protocol: input.protocol,
        status: 'ACTIVE',
      });
      await this.autoProvisionVehicle(ctx, device.id, input);
    } catch (err) {
      if (err instanceof ConflictException && /IMEI/i.test(err.message)) {
        return this.resolve(input.imei);
      }
      throw err;
    }
    return this.resolve(input.imei);
  }

  private async resolveVehicle(tenantId: string, vehicleCode: string): Promise<VehicleRow | null> {
    if (!this.vehicles) return null;
    const out: VehicleRow[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 50; n += 1) {
      const page = await this.vehicles.list(tenantId, {}, { cursor, limit: 200 });
      out.push(...page.data);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const index = indexByLookup(out, (v) => [...lookupKeys(v.code), ...lookupKeys(v.name)]);
    return matchIndexed(index, vehicleCode);
  }

  private async bindImported(
    ctx: ActorContext,
    vehicleId: string,
    deviceId: string,
  ): Promise<void> {
    if (!this.bindings) return;
    try {
      await this.bindings.bind(ctx, vehicleId, deviceId, { role: 'TRACKER', isPrimary: true });
    } catch (err) {
      if (err instanceof ConflictException && /primary/i.test(err.message)) {
        await this.bindings.bind(ctx, vehicleId, deviceId, { role: 'TRACKER', isPrimary: false });
        return;
      }
      throw err;
    }
  }

  /**
   * Create (or reuse) a fleet, a vehicle named after the IMEI, and bind the
   * device so it shows on the map. Map presence is vehicles × status × GPS —
   * an unbound device never appears there.
   */
  private async autoProvisionVehicle(
    ctx: ActorContext,
    deviceId: string,
    input: EnrollDeviceInput,
  ): Promise<void> {
    const vehicles = this.vehicles;
    const bindings = this.bindings;
    const fleets = this.fleets;
    if (!vehicles || !bindings || !fleets) return;
    const fleetId = await this.ensureAutoFleet(ctx);
    const vehicleCode = `D${input.imei}`;
    let vehicleId: string;
    const existingVehicle = await vehicles.findByCode(ctx.tenantId, vehicleCode);
    if (existingVehicle) {
      vehicleId = existingVehicle.id;
    } else {
      try {
        const row = await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
          await assertTenantResourceQuota(trx, ctx.tenantId, 'vehicles');
          const created = await vehicles.create(trx, ctx.tenantId, {
            fleetId,
            name: `Device ${input.imei}`,
            code: vehicleCode,
          });
          await this.audit.append(trx, {
            ...this.entry(ctx, 'vehicle.created', created.id, null, created),
            resourceType: 'vehicle',
          });
          return created;
        });
        vehicleId = row.id;
      } catch (err) {
        if (err instanceof TenantQuotaDeniedError) throw new ForbiddenException(err.message);
        const mapped = mapUniqueViolation(err);
        const clash = await vehicles.findByCode(ctx.tenantId, vehicleCode);
        if (clash) {
          vehicleId = clash.id;
        } else {
          throw mapped;
        }
      }
    }
    const roles = rolesFor(input.protocol);
    try {
      await bindings.bind(ctx, vehicleId, deviceId, { roles, isPrimary: true });
    } catch (err) {
      if (err instanceof ConflictException && /already bound/i.test(err.message)) return;
      if (err instanceof ConflictException && /primary/i.test(err.message)) {
        await bindings.bind(ctx, vehicleId, deviceId, { roles, isPrimary: false });
        return;
      }
      throw err;
    }
  }

  /** Prefer an existing ACTIVE fleet; otherwise create tenant-local `AUTO`. */
  private async ensureAutoFleet(ctx: ActorContext): Promise<string> {
    const fleets = this.fleets;
    if (!fleets) throw new ForbiddenException('Auto-enroll is not wired.');
    const auto = await fleets.findByCode(ctx.tenantId, AUTO_FLEET_CODE);
    if (auto && auto.status === 'ACTIVE') return auto.id;
    const page = await fleets.list(ctx.tenantId, { status: 'ACTIVE' }, { limit: 1 });
    if (page.data[0]) return page.data[0].id;
    try {
      const row = await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
        const created = await fleets.create(trx, ctx.tenantId, {
          name: AUTO_FLEET_NAME,
          code: AUTO_FLEET_CODE,
        });
        await this.audit.append(trx, {
          ...this.entry(ctx, 'fleet.created', created.id, null, created),
          resourceType: 'fleet',
        });
        return created;
      });
      return row.id;
    } catch (err) {
      const mapped = mapUniqueViolation(err);
      const existing = await fleets.findByCode(ctx.tenantId, AUTO_FLEET_CODE);
      if (existing) return existing.id;
      throw mapped;
    }
  }

  private entry(
    ctx: ActorContext,
    action: string,
    resourceId: string,
    before: unknown,
    after: unknown,
  ) {
    return {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      action,
      resourceType: 'device',
      resourceId,
      permission: null,
      outcome: 'SUCCESS' as const,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      before,
      after,
    };
  }
}

function importErrorMessage(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  if (err instanceof Error) return err.message;
  return 'Import failed.';
}

const AUTO_FLEET_CODE = 'AUTO';
const AUTO_FLEET_NAME = 'Auto-enrolled';

function manufacturerFor(protocol: Protocol): string {
  switch (protocol) {
    case 'meitrack':
      return 'Meitrack';
    case 'gt06':
      return 'Concox';
    case 'jt808':
      return 'JT808';
    default:
      return 'Auto';
  }
}

function rolesFor(protocol: Protocol): DeviceRole[] {
  return protocol === 'meitrack' ? ['TRACKER', 'MDVR'] : ['TRACKER'];
}

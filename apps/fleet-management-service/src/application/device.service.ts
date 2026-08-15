import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';
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
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DeviceResolution, DeviceStatus } from '../domain/device/device-types.js';
import type { DeviceRecord } from '../domain/device/device-types.js';
import type { RegistryInvalidationPublisher } from '../infrastructure/cache/registry-invalidation-publisher.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import {
  type DeviceListFilters,
  DeviceRepository,
} from '../infrastructure/persistence/device.repository.js';
import { mapUniqueViolation } from './db-errors.js';
import type { ActorContext } from './service-context.js';
import type { CreateDeviceInput, UpdateDeviceInput } from './validation/schemas.js';

export class DeviceService {
  constructor(
    private readonly knex: Knex,
    private readonly devices: DeviceRepository,
    private readonly audit: AuditRepository,
    /** Sprint D §11 — push-based gateway cache invalidation (best-effort). */
    private readonly invalidation: RegistryInvalidationPublisher | null = null,
  ) {}

  // --- Management API -------------------------------------------------------

  public async create(ctx: ActorContext, input: CreateDeviceInput): Promise<DeviceRecord> {
    try {
      return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
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
      throw mapUniqueViolation(err);
    }
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

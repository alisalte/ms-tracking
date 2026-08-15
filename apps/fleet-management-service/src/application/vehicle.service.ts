import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';
import type { Page } from '@fleetvision/shared-kernel';
/**
 * VehicleService — vehicle use-cases, wrapped in a tenant-scoped transaction with
 * audit. A vehicle's `fleetId` must belong to the same tenant (cross-tenant fleet
 * reference is rejected). DELETE = archive (§27).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { VehicleRecord } from '../domain/vehicle/vehicle-types.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import type { FleetRepository } from '../infrastructure/persistence/fleet.repository.js';
import {
  type VehicleListFilters,
  VehicleRepository,
} from '../infrastructure/persistence/vehicle.repository.js';
import { mapUniqueViolation } from './db-errors.js';
import type { ActorContext } from './service-context.js';
import type { CreateVehicleInput, UpdateVehicleInput } from './validation/schemas.js';

export class VehicleService {
  constructor(
    private readonly knex: Knex,
    private readonly vehicles: VehicleRepository,
    private readonly fleets: FleetRepository,
    private readonly audit: AuditRepository,
  ) {}

  public async create(ctx: ActorContext, input: CreateVehicleInput): Promise<VehicleRecord> {
    await this.requireFleetInTenant(ctx.tenantId, input.fleetId);
    try {
      return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
        const row = await this.vehicles.create(trx, ctx.tenantId, input);
        const record = VehicleRepository.toRecord(row);
        await this.audit.append(trx, this.entry(ctx, 'vehicle.created', record.id, null, record));
        return record;
      });
    } catch (err) {
      throw mapUniqueViolation(err);
    }
  }

  public async get(ctx: ActorContext, id: string): Promise<VehicleRecord> {
    const row = await this.vehicles.findById(ctx.tenantId, id);
    if (!row) throw new NotFoundException('Vehicle not found.');
    return VehicleRepository.toRecord(row);
  }

  public async list(
    ctx: ActorContext,
    filters: VehicleListFilters,
    opts: { cursor?: string; limit: number },
  ): Promise<Page<VehicleRecord>> {
    const page = await this.vehicles.list(ctx.tenantId, filters, opts);
    return { data: page.data.map(VehicleRepository.toRecord), nextCursor: page.nextCursor };
  }

  public async update(
    ctx: ActorContext,
    id: string,
    input: UpdateVehicleInput,
  ): Promise<VehicleRecord> {
    const current = await this.vehicles.findById(ctx.tenantId, id);
    if (!current) throw new NotFoundException('Vehicle not found.');
    if (input.fleetId && input.fleetId !== current.fleet_id) {
      await this.requireFleetInTenant(ctx.tenantId, input.fleetId);
    }
    return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const row = await this.vehicles.update(trx, ctx.tenantId, id, input, current.version);
      if (!row) throw new ConflictException('Vehicle was modified by another request.');
      const record = VehicleRepository.toRecord(row);
      await this.audit.append(trx, this.entry(ctx, 'vehicle.updated', id, current, record));
      return record;
    });
  }

  public async archive(ctx: ActorContext, id: string): Promise<VehicleRecord> {
    const current = await this.vehicles.findById(ctx.tenantId, id);
    if (!current) throw new NotFoundException('Vehicle not found.');
    return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const row = await this.vehicles.archive(trx, ctx.tenantId, id, current.version);
      if (!row) throw new ConflictException('Vehicle was modified by another request.');
      const record = VehicleRepository.toRecord(row);
      await this.audit.append(trx, this.entry(ctx, 'vehicle.archived', id, current, record));
      return record;
    });
  }

  /** Ensure the fleet belongs to the caller's tenant (cross-tenant fleet guard). */
  private async requireFleetInTenant(tenantId: string, fleetId: string): Promise<void> {
    const fleet = await this.fleets.findById(tenantId, fleetId);
    if (!fleet) throw new NotFoundException('Fleet not found in your tenant.');
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
      resourceType: 'vehicle',
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

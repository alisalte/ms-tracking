import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';
import type { Page } from '@fleetvision/shared-kernel';
/**
 * FleetService — fleet use-cases (create/get/list/update/archive), wrapped in a
 * tenant-scoped transaction with audit (Sprint C §28). DELETE is an archive
 * (status → ARCHIVED), never a hard delete (§27).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { FleetRecord } from '../domain/fleet/fleet-types.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import {
  type FleetListFilters,
  FleetRepository,
} from '../infrastructure/persistence/fleet.repository.js';
import { mapUniqueViolation } from './db-errors.js';
import type { ActorContext } from './service-context.js';
import type { CreateFleetInput, UpdateFleetInput } from './validation/schemas.js';

export class FleetService {
  constructor(
    private readonly knex: Knex,
    private readonly fleets: FleetRepository,
    private readonly audit: AuditRepository,
  ) {}

  public async create(ctx: ActorContext, input: CreateFleetInput): Promise<FleetRecord> {
    const existing = await this.fleets.findByCode(ctx.tenantId, input.code);
    if (existing) throw new ConflictException('A fleet with this code already exists.');
    try {
      return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
        const row = await this.fleets.create(trx, ctx.tenantId, input);
        const record = FleetRepository.toRecord(row);
        await this.audit.append(trx, this.entry(ctx, 'fleet.created', record.id, null, record));
        return record;
      });
    } catch (err) {
      throw mapUniqueViolation(err);
    }
  }

  public async get(ctx: ActorContext, id: string): Promise<FleetRecord> {
    const row = await this.fleets.findById(ctx.tenantId, id);
    if (!row) throw new NotFoundException('Fleet not found.');
    return FleetRepository.toRecord(row);
  }

  public async list(
    ctx: ActorContext,
    filters: FleetListFilters,
    opts: { cursor?: string; limit: number },
  ): Promise<Page<FleetRecord>> {
    const page = await this.fleets.list(ctx.tenantId, filters, opts);
    return { data: page.data.map(FleetRepository.toRecord), nextCursor: page.nextCursor };
  }

  public async update(
    ctx: ActorContext,
    id: string,
    input: UpdateFleetInput,
  ): Promise<FleetRecord> {
    const current = await this.fleets.findById(ctx.tenantId, id);
    if (!current) throw new NotFoundException('Fleet not found.');
    if (current.code !== input.code) {
      const clash = await this.fleets.findByCode(ctx.tenantId, input.code);
      if (clash) throw new ConflictException('A fleet with this code already exists.');
    }
    return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const row = await this.fleets.update(trx, ctx.tenantId, id, input, current.version);
      if (!row) throw new ConflictException('Fleet was modified by another request.');
      const record = FleetRepository.toRecord(row);
      await this.audit.append(trx, this.entry(ctx, 'fleet.updated', id, current, record));
      return record;
    });
  }

  public async archive(ctx: ActorContext, id: string): Promise<FleetRecord> {
    const current = await this.fleets.findById(ctx.tenantId, id);
    if (!current) throw new NotFoundException('Fleet not found.');
    return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const row = await this.fleets.archive(trx, ctx.tenantId, id, current.version);
      if (!row) throw new ConflictException('Fleet was modified by another request.');
      const record = FleetRepository.toRecord(row);
      await this.audit.append(trx, this.entry(ctx, 'fleet.archived', id, current, record));
      return record;
    });
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
      resourceType: 'fleet',
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

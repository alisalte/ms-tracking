import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';
import type { Page } from '@fleetvision/shared-kernel';
/**
 * VehicleService — vehicle use-cases, wrapped in a tenant-scoped transaction with
 * audit. A vehicle's `fleetId` must belong to the same tenant (cross-tenant fleet
 * reference is rejected). DELETE = archive (§27).
 */
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { VehicleRecord } from '../domain/vehicle/vehicle-types.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import { FleetRepository, type FleetRow } from '../infrastructure/persistence/fleet.repository.js';
import {
  type VehicleListFilters,
  VehicleRepository,
} from '../infrastructure/persistence/vehicle.repository.js';
import { indexByLookup, lookupKeys, matchIndexed, toAssetCode } from './code-lookup.js';
import { mapUniqueViolation } from './db-errors.js';
import type { ImportResult } from './import-result.js';
import type { ActorContext } from './service-context.js';
import {
  type CreateVehicleInput,
  type UpdateVehicleInput,
  importVehicleRowSchema,
} from './validation/schemas.js';

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

  /**
   * Spreadsheet import: resolve each row's `fleetCode` (creating the fleet when
   * it does not exist), then create the vehicle. One bad row does not roll back
   * the others (partial success).
   */
  public async importMany(
    ctx: ActorContext,
    rows: ReadonlyArray<Record<string, unknown>>,
  ): Promise<ImportResult<VehicleRecord>> {
    const created: VehicleRecord[] = [];
    const failed: ImportResult<VehicleRecord>['failed'] = [];
    const warnings: ImportResult<VehicleRecord>['warnings'] = [];
    const allFleets = await this.listAllFleets(ctx.tenantId);
    const fleetIndex = indexByLookup(allFleets, (f) => [
      ...lookupKeys(f.code),
      ...lookupKeys(f.name),
    ]);
    const fleetCache = new Map<string, FleetRow | 'invalid' | 'archived'>();

    for (let i = 0; i < rows.length; i += 1) {
      const raw = rows[i] ?? {};
      const rowNum = Number.isFinite(Number(raw.row)) ? Number(raw.row) : i + 2;
      try {
        const parsed = importVehicleRowSchema.safeParse(raw);
        if (!parsed.success) {
          failed.push({
            row: rowNum,
            error: parsed.error.issues[0]?.message ?? 'Invalid vehicle row.',
          });
          continue;
        }
        const input = parsed.data;
        const cacheKey = lookupKeys(input.fleetCode)[0] ?? input.fleetCode.toLowerCase();
        let resolved = fleetCache.get(cacheKey);
        if (resolved === undefined) {
          const found = matchIndexed(fleetIndex, input.fleetCode);
          if (found?.status === 'ARCHIVED') {
            resolved = 'archived';
          } else if (found) {
            resolved = found;
          } else {
            const code = toAssetCode(input.fleetCode);
            if (!code) {
              resolved = 'invalid';
            } else {
              const createdFleet = await this.createFleetForImport(ctx, code, input.fleetCode);
              for (const k of lookupKeys(createdFleet.code).concat(lookupKeys(createdFleet.name))) {
                const arr = fleetIndex.get(k) ?? [];
                if (!arr.includes(createdFleet)) arr.push(createdFleet);
                fleetIndex.set(k, arr);
              }
              warnings.push({
                row: rowNum,
                error: `Fleet '${createdFleet.code}' did not exist and was created.`,
              });
              resolved = createdFleet;
            }
          }
          fleetCache.set(cacheKey, resolved);
        }
        if (resolved === 'invalid') {
          failed.push({
            row: rowNum,
            error: `Fleet code '${input.fleetCode}' is not a valid fleet code.`,
          });
          continue;
        }
        if (resolved === 'archived') {
          failed.push({ row: rowNum, error: `Fleet '${input.fleetCode}' is archived.` });
          continue;
        }
        created.push(
          await this.create(ctx, {
            fleetId: resolved.id,
            name: input.name,
            code: input.code,
            plate: input.plate,
            vin: input.vin,
          }),
        );
      } catch (err) {
        failed.push({ row: rowNum, error: importErrorMessage(err) });
      }
    }
    return { created, failed, warnings };
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

  private async listAllFleets(tenantId: string): Promise<FleetRow[]> {
    const out: FleetRow[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 50; n += 1) {
      const page = await this.fleets.list(tenantId, {}, { cursor, limit: 200 });
      out.push(...page.data);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  }

  private async createFleetForImport(
    ctx: ActorContext,
    code: string,
    label: string,
  ): Promise<FleetRow> {
    const name = label.trim() || code;
    try {
      return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
        const row = await this.fleets.create(trx, ctx.tenantId, { name, code });
        await this.audit.append(trx, {
          ...this.entry(ctx, 'fleet.created', row.id, null, FleetRepository.toRecord(row)),
          resourceType: 'fleet',
        });
        return row;
      });
    } catch (err) {
      const mapped = mapUniqueViolation(err);
      const existing = await this.fleets.findByCode(ctx.tenantId, code);
      if (existing) return existing;
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

function importErrorMessage(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  if (err instanceof Error) return err.message;
  return 'Import failed.';
}

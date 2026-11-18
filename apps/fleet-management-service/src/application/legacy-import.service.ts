/**
 * LegacyImportService — moves units from the previous tracking system
 * (objects CSV / Wialon "Units" sheet) into the registry.
 *
 * One row = one tracker on one vehicle, upserted by IMEI so the import can be
 * re-run safely and never splits a tracker's history:
 *
 *   1. fleet   — matched by name or code; created when missing.
 *   2. device  — reused when the IMEI is already registered to this account
 *                (e.g. auto-enrolled on its first packet); created otherwise,
 *                protocol taken from the legacy model. SIM number stored.
 *   3. vehicle — the vehicle the tracker is already bound to (an auto-enrolled
 *                placeholder included) is renamed and moved to the fleet;
 *                otherwise a vehicle `L<imei>` is reused or created.
 *   4. binding — the tracker is bound to that vehicle (primary when free).
 *
 * Partial success: each row stands alone and reports its own error/warnings.
 * Every write is audited.
 */
import {
  type Knex,
  TenantQuotaDeniedError,
  assertTenantResourceQuota,
  withTenantContext,
} from '@fleetvision/persistence-knex';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Protocol } from '../domain/device/device-types.js';
import {
  autoVehicleCode,
  bareModel,
  legacyVehicleCode,
  manufacturerForProtocol,
  primarySim,
  protocolForModel,
  temperatureShift,
} from '../domain/legacy-units.js';
import type { RegistryInvalidationPublisher } from '../infrastructure/cache/registry-invalidation-publisher.js';
import type {
  AuditEntry,
  AuditRepository,
} from '../infrastructure/persistence/audit.repository.js';
import type { BindingRepository } from '../infrastructure/persistence/binding.repository.js';
import type { DeviceInboxRepository } from '../infrastructure/persistence/device-inbox.repository.js';
import type { DeviceRow } from '../infrastructure/persistence/device.repository.js';
import type { FleetRow } from '../infrastructure/persistence/fleet.repository.js';
import type { VehicleRow } from '../infrastructure/persistence/vehicle.repository.js';
import type { BindingService } from './binding.service.js';
import { indexByLookup, lookupKeys, matchIndexed, toAssetCode } from './code-lookup.js';
import { isUniqueViolation } from './db-errors.js';
import type { ActorContext } from './service-context.js';
import { type LegacyUnitRowInput, legacyUnitRowSchema } from './validation/schemas.js';

export type LegacyRowOutcome = 'CREATED' | 'UPDATED' | 'FAILED';

export interface LegacyRowResult {
  readonly row: number;
  readonly imei: string | null;
  readonly name: string | null;
  readonly outcome: LegacyRowOutcome;
  readonly vehicleId?: string;
  readonly deviceId?: string;
  readonly error?: string;
  readonly warnings: string[];
}

export interface LegacyImportResult {
  readonly created: number;
  readonly updated: number;
  readonly failed: number;
  readonly fleetsCreated: string[];
  readonly rows: LegacyRowResult[];
}

export class LegacyImportService {
  constructor(
    private readonly knex: Knex,
    private readonly audit: AuditRepository,
    private readonly bindingRepo: BindingRepository,
    private readonly bindings: BindingService,
    private readonly invalidation: RegistryInvalidationPublisher | null = null,
    private readonly inbox: DeviceInboxRepository | null = null,
  ) {}

  public async importUnits(
    ctx: ActorContext,
    rows: ReadonlyArray<Record<string, unknown>>,
    defaultProtocol?: Protocol,
  ): Promise<LegacyImportResult> {
    const fleets = await this.loadFleets(ctx.tenantId);
    const fleetsCreated: string[] = [];
    const results: LegacyRowResult[] = [];

    for (let i = 0; i < rows.length; i += 1) {
      const raw = rows[i] ?? {};
      const rowNum = Number.isFinite(Number(raw.row)) ? Number(raw.row) : i + 2;
      const parsed = legacyUnitRowSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        results.push({
          row: rowNum,
          imei: typeof raw.imei === 'string' ? raw.imei : null,
          name: typeof raw.name === 'string' ? raw.name : null,
          outcome: 'FAILED',
          error: issue ? `${issue.path.join('.') || 'row'}: ${issue.message}` : 'Invalid row.',
          warnings: [],
        });
        continue;
      }
      const input = parsed.data;
      try {
        const fleet = await this.ensureFleet(ctx, fleets, input.fleet, fleetsCreated);
        results.push(await this.importOne(ctx, rowNum, input, fleet, defaultProtocol));
      } catch (err) {
        results.push({
          row: rowNum,
          imei: input.imei,
          name: input.name,
          outcome: 'FAILED',
          error: errorText(err),
          warnings: [],
        });
      }
    }
    return {
      created: results.filter((r) => r.outcome === 'CREATED').length,
      updated: results.filter((r) => r.outcome === 'UPDATED').length,
      failed: results.filter((r) => r.outcome === 'FAILED').length,
      fleetsCreated,
      rows: results,
    };
  }

  private async importOne(
    ctx: ActorContext,
    rowNum: number,
    input: LegacyUnitRowInput,
    fleet: FleetRow,
    defaultProtocol: Protocol | undefined,
  ): Promise<LegacyRowResult> {
    const warnings: string[] = [];
    const sim = primarySim(input.simNumber);
    const offset = input.temperatureOffsetC ?? temperatureShift(input.legacyFields);
    const legacyFields =
      input.legacyFields || input.groups
        ? { ...(input.legacyFields ?? {}), ...(input.groups ? { groups: input.groups } : {}) }
        : null;

    // ── device ──
    let device = await this.findDevice(ctx.tenantId, input.imei);
    let deviceCreated = false;
    if (device) {
      const patch: Record<string, unknown> = {};
      if (sim && device.sim_number !== sim) patch.sim_number = sim;
      const model = bareModel(input.model);
      if (model && !device.model) patch.model = model;
      if (Object.keys(patch).length > 0) {
        await this.write(ctx, async (trx) => {
          await trx('fleet.devices')
            .whereRaw('tenant_id = ?::uuid AND id = ?::uuid', [ctx.tenantId, device?.id])
            .update({ ...patch, updated_at: trx.fn.now(), version: trx.raw('version + 1') });
          await this.audit.append(
            trx,
            this.entry(ctx, 'device.updated', 'device', device?.id ?? null, null, patch),
          );
        });
      }
    } else {
      const protocol = input.protocol ?? protocolForModel(input.model) ?? defaultProtocol;
      if (!protocol) {
        return failed(
          rowNum,
          input,
          `Device model '${input.model ?? '—'}' does not name a protocol.`,
        );
      }
      try {
        device = await this.write(ctx, async (trx) => {
          await assertTenantResourceQuota(trx, ctx.tenantId, 'devices');
          const [row] = await trx('fleet.devices')
            .insert({
              tenant_id: trx.raw('?::uuid', [ctx.tenantId]),
              imei: input.imei,
              manufacturer: manufacturerForProtocol(protocol),
              model: bareModel(input.model),
              protocol,
              status: input.active === false ? 'SUSPENDED' : 'ACTIVE',
              sim_number: sim,
            })
            .returning('*');
          await this.audit.append(
            trx,
            this.entry(ctx, 'device.created', 'device', row.id, null, row),
          );
          return row as DeviceRow & { sim_number: string | null };
        });
        deviceCreated = true;
      } catch (err) {
        if (isUniqueViolation(err)) {
          return failed(rowNum, input, 'This IMEI is registered to another account.');
        }
        throw err;
      }
      if (this.inbox) {
        await this.inbox.markClaimed(input.imei, ctx.tenantId, device.id).catch(() => undefined);
      }
    }
    const dev = device as DeviceRow & { sim_number: string | null };

    // ── vehicle ──
    const binding = await this.bindingRepo.findBindingByDevice(ctx.tenantId, dev.id);
    let vehicle: VehicleRow | null = binding
      ? await this.findVehicle(ctx.tenantId, 'id', binding.vehicle_id)
      : null;
    vehicle ??= await this.findVehicle(ctx.tenantId, 'code', legacyVehicleCode(input.imei));
    vehicle ??= await this.findVehicle(ctx.tenantId, 'code', autoVehicleCode(input.imei));

    const fields: Record<string, unknown> = {
      name: input.name,
      fleet_id: this.knex.raw('?::uuid', [fleet.id]),
    };
    if (input.vin) fields.vin = input.vin;
    if (input.odometerKm !== undefined && input.odometerKm > 0)
      fields.odometer_km = input.odometerKm;
    if (input.engineHours !== undefined && input.engineHours > 0)
      fields.engine_hours = input.engineHours;
    if (offset !== null) fields.temperature_offset_c = offset;
    if (legacyFields) fields.legacy_fields = JSON.stringify(legacyFields);

    const vehicleCreated = !vehicle;
    const saved = await this.saveVehicle(ctx, vehicle, fields, input, warnings);

    // ── binding ──
    if (!binding || binding.vehicle_id !== saved.id) {
      if (binding) {
        warnings.push('Tracker was bound to another vehicle; that binding was kept.');
      } else {
        await this.bind(ctx, saved.id, dev, warnings);
      }
    }
    if (!deviceCreated && this.invalidation) {
      this.invalidation.invalidate(input.imei, 'device.updated', ctx.tenantId);
    }

    return {
      row: rowNum,
      imei: input.imei,
      name: input.name,
      outcome: deviceCreated && vehicleCreated ? 'CREATED' : 'UPDATED',
      vehicleId: saved.id,
      deviceId: dev.id,
      warnings,
    };
  }

  /** Update the vehicle (or create `L<imei>`); a clashing plate is dropped with a warning. */
  private async saveVehicle(
    ctx: ActorContext,
    vehicle: VehicleRow | null,
    fields: Record<string, unknown>,
    input: LegacyUnitRowInput,
    warnings: string[],
  ): Promise<VehicleRow> {
    const attempt = async (withPlate: boolean) =>
      this.write(ctx, async (trx) => {
        const data = { ...fields, ...(withPlate && input.plate ? { plate: input.plate } : {}) };
        if (vehicle) {
          const [row] = await trx('fleet.vehicles')
            .whereRaw('tenant_id = ?::uuid AND id = ?::uuid', [ctx.tenantId, vehicle.id])
            .update({ ...data, updated_at: trx.fn.now(), version: trx.raw('version + 1') })
            .returning('*');
          await this.audit.append(
            trx,
            this.entry(ctx, 'vehicle.updated', 'vehicle', vehicle.id, vehicle, row),
          );
          return row as VehicleRow;
        }
        await assertTenantResourceQuota(trx, ctx.tenantId, 'vehicles');
        const [row] = await trx('fleet.vehicles')
          .insert({
            ...data,
            tenant_id: trx.raw('?::uuid', [ctx.tenantId]),
            code: legacyVehicleCode(input.imei),
            status: 'ACTIVE',
          })
          .returning('*');
        await this.audit.append(
          trx,
          this.entry(ctx, 'vehicle.created', 'vehicle', row.id, null, row),
        );
        return row as VehicleRow;
      });
    try {
      return await attempt(true);
    } catch (err) {
      if (input.plate && isUniqueViolation(err, 'fleet_vehicles_tenant_plate_unique')) {
        warnings.push(`Plate '${input.plate}' is already used by another vehicle; not set.`);
        return attempt(false);
      }
      throw err;
    }
  }

  private async bind(
    ctx: ActorContext,
    vehicleId: string,
    device: DeviceRow,
    warnings: string[],
  ): Promise<void> {
    const roles =
      device.protocol === 'meitrack' ? (['TRACKER', 'MDVR'] as const) : (['TRACKER'] as const);
    try {
      await this.bindings.bind(ctx, vehicleId, device.id, { roles: [...roles], isPrimary: true });
    } catch (err) {
      if (err instanceof ConflictException && /primary/i.test(err.message)) {
        await this.bindings.bind(ctx, vehicleId, device.id, {
          roles: [...roles],
          isPrimary: false,
        });
        warnings.push('Vehicle already had a primary tracker; bound as secondary.');
        return;
      }
      warnings.push(`Not bound: ${errorText(err)}`);
    }
  }

  // ── fleets ──

  private async loadFleets(tenantId: string): Promise<Map<string, FleetRow[]>> {
    const rows = (await this.knex('fleet.fleets')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .where('status', 'ACTIVE')) as FleetRow[];
    return indexByLookup(rows, (f) => [...lookupKeys(f.code), ...lookupKeys(f.name)]);
  }

  private async ensureFleet(
    ctx: ActorContext,
    index: Map<string, FleetRow[]>,
    wanted: string,
    created: string[],
  ): Promise<FleetRow> {
    const found = matchIndexed(index, wanted);
    if (found) return found;
    const base = toAssetCode(wanted) ?? `FLEET-${shortHash(wanted)}`;
    let code = base.slice(0, 64);
    for (let n = 2; await this.fleetCodeTaken(ctx.tenantId, code); n += 1) {
      code = `${base.slice(0, 58)}-${n}`;
    }
    const row = await this.write(ctx, async (trx) => {
      const [r] = await trx('fleet.fleets')
        .insert({
          tenant_id: trx.raw('?::uuid', [ctx.tenantId]),
          name: wanted.trim(),
          code,
          description: 'Imported from the previous tracking system',
          status: 'ACTIVE',
        })
        .returning('*');
      await this.audit.append(trx, this.entry(ctx, 'fleet.created', 'fleet', r.id, null, r));
      return r as FleetRow;
    });
    for (const k of [...lookupKeys(row.code), ...lookupKeys(row.name)]) {
      index.set(k, [...(index.get(k) ?? []), row]);
    }
    created.push(row.name);
    return row;
  }

  private async fleetCodeTaken(tenantId: string, code: string): Promise<boolean> {
    const row = await this.knex('fleet.fleets')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .where('code', code)
      .first('id');
    return Boolean(row);
  }

  // ── reads ──

  private async findDevice(
    tenantId: string,
    imei: string,
  ): Promise<(DeviceRow & { sim_number: string | null }) | null> {
    const row = await this.knex('fleet.devices')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .where('imei', imei)
      .first();
    return (row as (DeviceRow & { sim_number: string | null }) | undefined) ?? null;
  }

  private async findVehicle(
    tenantId: string,
    by: 'id' | 'code',
    value: string,
  ): Promise<VehicleRow | null> {
    const q = this.knex('fleet.vehicles').whereRaw('tenant_id = ?::uuid', [tenantId]);
    const row = await (by === 'id'
      ? q.whereRaw('id = ?::uuid', [value])
      : q.where('code', value)
    ).first();
    return (row as VehicleRow | undefined) ?? null;
  }

  private async write<T>(ctx: ActorContext, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    try {
      return await withTenantContext(this.knex, ctx.tenantId, fn);
    } catch (err) {
      if (err instanceof TenantQuotaDeniedError) throw new ForbiddenException(err.message);
      throw err;
    }
  }

  private entry(
    ctx: ActorContext,
    action: string,
    resourceType: string,
    resourceId: string | null,
    before: unknown,
    after: unknown,
  ): AuditEntry {
    return {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      action,
      resourceType,
      resourceId,
      permission: null,
      outcome: 'SUCCESS',
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      before,
      after: after === null ? null : { ...(after as object), source: 'legacy-import' },
    };
  }
}

function failed(rowNum: number, input: LegacyUnitRowInput, error: string): LegacyRowResult {
  return {
    row: rowNum,
    imei: input.imei,
    name: input.name,
    outcome: 'FAILED',
    error,
    warnings: [],
  };
}

function errorText(err: unknown): string {
  const e = err as { message?: unknown; response?: { message?: unknown } };
  const m = e?.response?.message ?? e?.message;
  return Array.isArray(m) ? m.join('; ') : String(m ?? 'Unexpected error.');
}

/** Short stable ASCII tag for a non-ASCII name (fleet codes must be ASCII). */
function shortHash(text: string): string {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase();
}

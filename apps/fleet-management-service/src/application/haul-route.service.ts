/**
 * Mine haul routes: origin geofence, destination geofence, the shifts of the
 * work day, and the trucks and shovels assigned to the route. Each truck can
 * carry a per-shift driver roster, because two shifts drive the same truck.
 * Cycle detection itself runs in reporting over stored positions.
 */
import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type {
  AuditEntry,
  AuditRepository,
} from '../infrastructure/persistence/audit.repository.js';
import type { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import type { ActorContext } from './service-context.js';

export interface HaulRouteRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly originGeofenceId: string;
  readonly destinationGeofenceId: string;
  readonly shiftStartHour: number;
  readonly shiftDurationHours: number;
  readonly shiftCount: number;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface HaulMemberRecord {
  readonly id: string;
  readonly deviceId: string;
  readonly role: 'TRUCK' | 'SHOVEL';
  readonly imei: string | null;
  /** Element `n - 1` is the driver of shift `n`; null leaves that shift open. */
  readonly shiftDrivers: ReadonlyArray<string | null>;
}

export interface CreateHaulRouteInput {
  readonly name: string;
  readonly originGeofenceId: string;
  readonly destinationGeofenceId: string;
  readonly shiftStartHour?: number;
  readonly shiftDurationHours?: number;
  readonly shiftCount?: number;
}

export interface UpdateHaulRouteInput {
  readonly name?: string;
  readonly originGeofenceId?: string;
  readonly destinationGeofenceId?: string;
  readonly shiftStartHour?: number;
  readonly shiftDurationHours?: number;
  readonly shiftCount?: number;
}

export interface HaulMemberInput {
  readonly deviceId: string;
  /** Left out, the role is the machine type defined on the vehicle. */
  readonly role?: 'TRUCK' | 'SHOVEL';
  readonly shiftDrivers?: ReadonlyArray<string | null>;
}

interface RouteRow {
  id: string;
  tenant_id: string;
  name: string;
  origin_geofence_id: string;
  destination_geofence_id: string;
  shift_start_hour: number;
  shift_duration_hours: number;
  shift_count: number;
  status: 'ACTIVE' | 'ARCHIVED';
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class HaulRouteService {
  constructor(
    private readonly knex: Knex,
    private readonly audit: AuditRepository,
    private readonly devices: DeviceRepository,
  ) {}

  public async create(ctx: ActorContext, input: CreateHaulRouteInput): Promise<HaulRouteRecord> {
    if (input.originGeofenceId === input.destinationGeofenceId) {
      throw new ConflictException('Origin and destination must be different places.');
    }
    const shifts = checkShifts(
      input.shiftStartHour ?? 6,
      input.shiftDurationHours ?? 12,
      input.shiftCount ?? 2,
    );
    return withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const [row] = await trx
        .withSchema('fleet')
        .from('haul_routes')
        .insert({
          tenant_id: ctx.tenantId,
          name: input.name.trim(),
          origin_geofence_id: input.originGeofenceId,
          destination_geofence_id: input.destinationGeofenceId,
          shift_start_hour: shifts.startHour,
          shift_duration_hours: shifts.durationHours,
          shift_count: shifts.count,
        })
        .returning('*');
      const record = toRoute(row as RouteRow);
      await this.appendAudit(trx, ctx, 'haul_route.created', record.id, null, record);
      return record;
    });
  }

  public async update(
    ctx: ActorContext,
    id: string,
    input: UpdateHaulRouteInput,
  ): Promise<HaulRouteRecord> {
    const before = await this.get(ctx, id);
    if (before.status !== 'ACTIVE') throw new NotFoundException('Haul route not found.');
    const origin = input.originGeofenceId ?? before.originGeofenceId;
    const destination = input.destinationGeofenceId ?? before.destinationGeofenceId;
    if (origin === destination) {
      throw new ConflictException('Origin and destination must be different places.');
    }
    const shifts = checkShifts(
      input.shiftStartHour ?? before.shiftStartHour,
      input.shiftDurationHours ?? before.shiftDurationHours,
      input.shiftCount ?? before.shiftCount,
    );
    return withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const [row] = await trx
        .withSchema('fleet')
        .from('haul_routes')
        .whereRaw('tenant_id = ?::uuid', [ctx.tenantId])
        .whereRaw('id = ?::uuid', [id])
        .update({
          name: input.name?.trim() ?? before.name,
          origin_geofence_id: origin,
          destination_geofence_id: destination,
          shift_start_hour: shifts.startHour,
          shift_duration_hours: shifts.durationHours,
          shift_count: shifts.count,
          version: trx.raw('version + 1'),
          updated_at: trx.fn.now(),
        })
        .returning('*');
      const record = toRoute(row as RouteRow);
      await this.appendAudit(trx, ctx, 'haul_route.updated', id, before, record);
      return record;
    });
  }

  public async archive(ctx: ActorContext, id: string): Promise<void> {
    const before = await this.get(ctx, id);
    if (before.status === 'ARCHIVED') return;
    await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const [row] = await trx
        .withSchema('fleet')
        .from('haul_routes')
        .whereRaw('tenant_id = ?::uuid', [ctx.tenantId])
        .whereRaw('id = ?::uuid', [id])
        .update({
          status: 'ARCHIVED',
          version: trx.raw('version + 1'),
          updated_at: trx.fn.now(),
        })
        .returning('*');
      await this.appendAudit(trx, ctx, 'haul_route.archived', id, before, toRoute(row as RouteRow));
    });
  }

  public async list(ctx: ActorContext): Promise<HaulRouteRecord[]> {
    const rows = (await this.knex
      .withSchema('fleet')
      .from('haul_routes')
      .whereRaw('tenant_id = ?::uuid', [ctx.tenantId])
      .where('status', 'ACTIVE')
      .orderBy('name')) as RouteRow[];
    return rows.map(toRoute);
  }

  public async get(ctx: ActorContext, id: string): Promise<HaulRouteRecord> {
    const row = (await this.knex
      .withSchema('fleet')
      .from('haul_routes')
      .whereRaw('tenant_id = ?::uuid', [ctx.tenantId])
      .whereRaw('id = ?::uuid', [id])
      .first()) as RouteRow | undefined;
    if (!row) throw new NotFoundException('Haul route not found.');
    return toRoute(row);
  }

  public async members(ctx: ActorContext, routeId: string): Promise<HaulMemberRecord[]> {
    await this.get(ctx, routeId);
    const rows = (await this.knex('fleet.haul_members as m')
      .leftJoin('fleet.devices as d', 'd.id', 'm.device_id')
      .whereRaw('m.tenant_id = ?::uuid', [ctx.tenantId])
      .whereRaw('m.route_id = ?::uuid', [routeId])
      .select('m.id', 'm.device_id', 'm.role', 'm.shift_drivers', 'd.imei')) as Array<{
      id: string;
      device_id: string;
      role: 'TRUCK' | 'SHOVEL';
      shift_drivers: Array<string | null> | null;
      imei: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      role: row.role,
      imei: row.imei,
      shiftDrivers: Array.isArray(row.shift_drivers) ? row.shift_drivers : [],
    }));
  }

  public async setMembers(
    ctx: ActorContext,
    routeId: string,
    members: readonly HaulMemberInput[],
  ): Promise<HaulMemberRecord[]> {
    const route = await this.get(ctx, routeId);
    const before = await this.members(ctx, routeId);
    const seen = new Set<string>();
    const machineTypes = await this.machineTypes(
      ctx,
      members.filter((member) => !member.role).map((member) => member.deviceId),
    );
    const resolved = members.map((member) => {
      const role = member.role ?? machineTypes.get(member.deviceId);
      if (!role) {
        throw new BadRequestException(
          'Machine type is not set on the vehicle. Define it in the vehicle definition.',
        );
      }
      return { ...member, role };
    });
    const rosters = resolved.map((member) =>
      member.role === 'TRUCK' ? normalizeRoster(member.shiftDrivers, route.shiftCount) : [],
    );
    const busy = new Map<string, string>();
    for (const [index, member] of resolved.entries()) {
      if (seen.has(member.deviceId)) {
        throw new ConflictException('A device can only be assigned once on a route.');
      }
      seen.add(member.deviceId);
      const device = await this.devices.findById(ctx.tenantId, member.deviceId);
      if (!device) throw new NotFoundException('Device not found.');
      for (const [shift, driverId] of (rosters[index] ?? []).entries()) {
        if (!driverId) continue;
        const key = `${shift}|${driverId}`;
        if (busy.has(key)) {
          throw new ConflictException(`A driver can only drive one truck in shift ${shift + 1}.`);
        }
        busy.set(key, member.deviceId);
      }
    }
    const driverIds = [...new Set(rosters.flat().filter((id): id is string => Boolean(id)))];
    await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      if (driverIds.length > 0) {
        const found = (await trx('fleet.drivers')
          .whereRaw('tenant_id = ?::uuid', [ctx.tenantId])
          .whereIn('id', driverIds)
          .select('id')) as Array<{ id: string }>;
        if (found.length !== driverIds.length) throw new NotFoundException('Driver not found.');
      }
      await trx
        .withSchema('fleet')
        .from('haul_members')
        .whereRaw('tenant_id = ?::uuid', [ctx.tenantId])
        .whereRaw('route_id = ?::uuid', [routeId])
        .delete();
      const after = resolved.map((member, index) => ({
        deviceId: member.deviceId,
        role: member.role,
        shiftDrivers: rosters[index] ?? [],
      }));
      await this.appendAudit(trx, ctx, 'haul_route.members_set', routeId, before, after);
      if (resolved.length === 0) return;
      await trx
        .withSchema('fleet')
        .from('haul_members')
        .insert(
          resolved.map((member, index) => ({
            tenant_id: ctx.tenantId,
            route_id: routeId,
            device_id: member.deviceId,
            role: member.role,
            shift_drivers: rosters[index] ?? [],
          })),
        );
    });
    return this.members(ctx, routeId);
  }

  /** Machine type of the vehicle each device is bound to (devices without one are absent). */
  private async machineTypes(
    ctx: ActorContext,
    deviceIds: readonly string[],
  ): Promise<Map<string, 'TRUCK' | 'SHOVEL'>> {
    if (deviceIds.length === 0) return new Map();
    const rows = (await this.knex('fleet.vehicle_devices as vd')
      .join('fleet.vehicles as v', 'v.id', 'vd.vehicle_id')
      .whereRaw('vd.tenant_id = ?::uuid', [ctx.tenantId])
      .whereIn('vd.device_id', [...deviceIds])
      .whereNotNull('v.machine_type')
      .select('vd.device_id', 'v.machine_type')) as Array<{
      device_id: string;
      machine_type: 'TRUCK' | 'SHOVEL';
    }>;
    return new Map(rows.map((row) => [row.device_id, row.machine_type]));
  }

  private async appendAudit(
    trx: Knex.Transaction,
    ctx: ActorContext,
    action: string,
    resourceId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await this.audit.append(trx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      action,
      resourceType: 'haul_route',
      resourceId,
      permission: null,
      outcome: 'SUCCESS',
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      before,
      after,
    } satisfies AuditEntry);
  }
}

/** Shifts must fit back-to-back inside one 24 h work day. */
export function checkShifts(
  startHour: number,
  durationHours: number,
  count: number,
): { startHour: number; durationHours: number; count: number } {
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    throw new BadRequestException('Shift start hour must be between 0 and 23.');
  }
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 24) {
    throw new BadRequestException('Shift length must be between 1 and 24 hours.');
  }
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new BadRequestException('A work day has between 1 and 4 shifts.');
  }
  if (count * durationHours > 24) {
    throw new BadRequestException('All shifts together cannot exceed 24 hours.');
  }
  return { startHour, durationHours, count };
}

/** Trim to the route's shift count; drop trailing empty shifts. */
export function normalizeRoster(
  drivers: ReadonlyArray<string | null> | undefined,
  shiftCount: number,
): Array<string | null> {
  const roster = (drivers ?? []).slice(0, shiftCount).map((id) => id || null);
  while (roster.length > 0 && roster[roster.length - 1] === null) roster.pop();
  return roster;
}

function toRoute(row: RouteRow): HaulRouteRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    originGeofenceId: row.origin_geofence_id,
    destinationGeofenceId: row.destination_geofence_id,
    shiftStartHour: row.shift_start_hour,
    shiftDurationHours: row.shift_duration_hours,
    shiftCount: row.shift_count ?? 1,
    status: row.status,
    version: row.version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

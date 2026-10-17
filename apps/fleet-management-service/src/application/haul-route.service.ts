/**
 * Mine haul routes: origin geofence, destination geofence, shift window, and
 * the trucks and shovels assigned to the route. Cycle detection itself runs
 * in reporting over stored positions.
 */
import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
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
}

export interface CreateHaulRouteInput {
  readonly name: string;
  readonly originGeofenceId: string;
  readonly destinationGeofenceId: string;
  readonly shiftStartHour?: number;
  readonly shiftDurationHours?: number;
}

export interface HaulMemberInput {
  readonly deviceId: string;
  readonly role: 'TRUCK' | 'SHOVEL';
}

interface RouteRow {
  id: string;
  tenant_id: string;
  name: string;
  origin_geofence_id: string;
  destination_geofence_id: string;
  shift_start_hour: number;
  shift_duration_hours: number;
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
    return withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      const [row] = await trx
        .withSchema('fleet')
        .from('haul_routes')
        .insert({
          tenant_id: ctx.tenantId,
          name: input.name.trim(),
          origin_geofence_id: input.originGeofenceId,
          destination_geofence_id: input.destinationGeofenceId,
          shift_start_hour: input.shiftStartHour ?? 6,
          shift_duration_hours: input.shiftDurationHours ?? 12,
        })
        .returning('*');
      const record = toRoute(row as RouteRow);
      await this.audit.append(trx, {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        action: 'haul_route.created',
        resourceType: 'haul_route',
        resourceId: record.id,
        permission: null,
        outcome: 'SUCCESS',
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        before: null,
        after: record,
      });
      return record;
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
      .select('m.id', 'm.device_id', 'm.role', 'd.imei')) as Array<{
      id: string;
      device_id: string;
      role: 'TRUCK' | 'SHOVEL';
      imei: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      role: row.role,
      imei: row.imei,
    }));
  }

  public async setMembers(
    ctx: ActorContext,
    routeId: string,
    members: readonly HaulMemberInput[],
  ): Promise<HaulMemberRecord[]> {
    await this.get(ctx, routeId);
    const seen = new Set<string>();
    for (const member of members) {
      if (seen.has(member.deviceId)) {
        throw new ConflictException('A device can only be assigned once on a route.');
      }
      seen.add(member.deviceId);
      const device = await this.devices.findById(ctx.tenantId, member.deviceId);
      if (!device) throw new NotFoundException('Device not found.');
    }
    await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      await trx
        .withSchema('fleet')
        .from('haul_members')
        .whereRaw('tenant_id = ?::uuid', [ctx.tenantId])
        .whereRaw('route_id = ?::uuid', [routeId])
        .delete();
      if (members.length === 0) return;
      await trx
        .withSchema('fleet')
        .from('haul_members')
        .insert(
          members.map((member) => ({
            tenant_id: ctx.tenantId,
            route_id: routeId,
            device_id: member.deviceId,
            role: member.role,
          })),
        );
    });
    return this.members(ctx, routeId);
  }
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
    status: row.status,
    version: row.version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * BindingRepository — maps the vehicle↔device relationship to `fleet.vehicle_devices`.
 *
 * The table holds CURRENT bindings only (unique device_id → a device is bound to at
 * most one vehicle; a partial unique index enforces ≤1 primary device per vehicle).
 * Binding history is captured in the audit log, so unbind is a row delete.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { VehicleDeviceRecord } from '../../domain/binding/binding-types.js';
import type { DeviceRole } from '../../domain/device/device-types.js';

const SCHEMA = 'fleet';
const TABLE = 'vehicle_devices';

export interface VehicleDeviceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly vehicle_id: string;
  readonly device_id: string;
  readonly role: DeviceRole;
  readonly is_primary: boolean;
  readonly bound_at: Date;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** A device joined with its current binding on a vehicle (for list views). */
export interface BoundDeviceView {
  readonly deviceId: string;
  readonly imei: string;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly protocol: string;
  readonly deviceStatus: string;
  readonly role: DeviceRole;
  readonly isPrimary: boolean;
  readonly boundAt: Date;
}

export class BindingRepository {
  constructor(private readonly knex: Knex) {}

  /** The device's current binding (tenant-scoped) — null if unbound. */
  public async findBindingByDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<VehicleDeviceRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('device_id = ?::uuid', [deviceId])
      .first();
    return (row as VehicleDeviceRow | undefined) ?? null;
  }

  /** The specific vehicle↔device binding (tenant-scoped) — null if not bound. */
  public async findBinding(
    tenantId: string,
    vehicleId: string,
    deviceId: string,
  ): Promise<VehicleDeviceRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .whereRaw('device_id = ?::uuid', [deviceId])
      .first();
    return (row as VehicleDeviceRow | undefined) ?? null;
  }

  /** True if the vehicle already has a primary device bound (the ≤1 rule). */
  public async hasPrimaryDevice(tenantId: string, vehicleId: string): Promise<boolean> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .where('is_primary', true)
      .first()
      .count({ n: '*' });
    return Number((row as { n: string | number }).n ?? 0) > 0;
  }

  /** Devices currently bound to a vehicle, joined with their device attributes. */
  public async listDevicesForVehicle(
    tenantId: string,
    vehicleId: string,
  ): Promise<BoundDeviceView[]> {
    // Cross-schema join (fleet.vehicle_devices + fleet.devices) — fully-qualified
    // names without withSchema() to avoid the double-prefix `fleet.fleet.devices`.
    const rows = await this.knex
      .from('fleet.vehicle_devices as vd')
      .join('fleet.devices as d', 'd.id', 'vd.device_id')
      .whereRaw('vd.tenant_id = ?::uuid', [tenantId])
      .whereRaw('vd.vehicle_id = ?::uuid', [vehicleId])
      .orderBy('vd.is_primary', 'desc')
      .orderBy('vd.bound_at', 'asc')
      .select<BoundDeviceView[]>(
        'vd.device_id as deviceId',
        'd.imei as imei',
        'd.manufacturer as manufacturer',
        'd.model as model',
        'd.protocol as protocol',
        'd.status as deviceStatus',
        'vd.role as role',
        'vd.is_primary as isPrimary',
        'vd.bound_at as boundAt',
      );
    return rows;
  }

  /** Bind a device to a vehicle (insert). Enforced constraints: unique device_id, ≤1 primary. */
  public async bind(
    trx: Knex.Transaction,
    tenantId: string,
    vehicleId: string,
    deviceId: string,
    role: DeviceRole,
    isPrimary: boolean,
  ): Promise<VehicleDeviceRow> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        tenant_id: trx.raw('?::uuid', [tenantId]),
        vehicle_id: trx.raw('?::uuid', [vehicleId]),
        device_id: trx.raw('?::uuid', [deviceId]),
        role,
        is_primary: isPrimary,
      })
      .returning('*');
    return row as VehicleDeviceRow;
  }

  /** Unbind a device from a vehicle (delete the current binding row). */
  public async unbind(
    trx: Knex.Transaction,
    tenantId: string,
    vehicleId: string,
    deviceId: string,
  ): Promise<VehicleDeviceRow | null> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .whereRaw('device_id = ?::uuid', [deviceId])
      .delete()
      .returning('*');
    return (row as VehicleDeviceRow | undefined) ?? null;
  }

  public static toRecord(row: VehicleDeviceRow): VehicleDeviceRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      vehicleId: row.vehicle_id,
      deviceId: row.device_id,
      role: row.role,
      isPrimary: row.is_primary,
      boundAt: new Date(row.bound_at),
      version: row.version,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

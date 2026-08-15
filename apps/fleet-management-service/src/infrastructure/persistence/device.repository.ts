/**
 * DeviceRepository — maps the Device aggregate to `fleet.devices` (the persistent
 * device registry, Sprint C §8).
 *
 * Two distinct access patterns:
 *   1. Tenant-scoped CRUD (management API) — every read filters `tenant_id`.
 *   2. CROSS-TENANT IMEI resolution (`resolveByImei`) — the device-gateway resolves
 *      an IMEI before the owning tenant is known, so this lookup is global (IMEI is
 *      the global physical key). It joins iam.tenants (active check) and
 *      fleet.vehicle_devices (current vehicle) and returns the trusted identity the
 *      gateway binds onto the session.
 *
 * Writes accept a transaction so they stay atomic with audit + binding.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { Page } from '@fleetvision/shared-kernel';
import type {
  DeviceResolution,
  DeviceStatus,
  Protocol,
  ResolvedDevice,
} from '../../domain/device/device-types.js';
import type { DeviceRecord } from '../../domain/device/device-types.js';
import { listPaginated } from './list-pagination.js';

const SCHEMA = 'fleet';
const TABLE = 'devices';

export interface DeviceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly imei: string;
  readonly serial_number: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly protocol: Protocol;
  readonly status: DeviceStatus;
  /** Present on LIST reads only (bound vehicle subquery); undefined elsewhere. */
  readonly vehicle_id?: string | null;
  readonly last_seen_at: Date | null;
  readonly connected_at: Date | null;
  readonly disconnected_at: Date | null;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface DeviceListFilters {
  readonly status?: DeviceStatus;
  readonly protocol?: Protocol;
  readonly manufacturer?: string;
  readonly vehicleId?: string;
  readonly imei?: string;
  readonly search?: string;
}

interface ResolveRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly status: DeviceStatus;
  readonly protocol: Protocol;
  readonly vehicle_id: string | null;
  readonly tenant_status: string | null;
}

export class DeviceRepository {
  constructor(private readonly knex: Knex) {}

  // --- Tenant-scoped reads (management API) --------------------------------

  public async findById(tenantId: string, id: string): Promise<DeviceRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .first();
    return (row as DeviceRow | undefined) ?? null;
  }

  public async findByImei(tenantId: string, imei: string): Promise<DeviceRow | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .where('imei', imei)
      .first();
    return (row as DeviceRow | undefined) ?? null;
  }

  public async list(
    tenantId: string,
    filters: DeviceListFilters,
    opts: { cursor?: string; limit: number },
  ): Promise<Page<DeviceRow>> {
    const base = this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId]);
    if (filters.status) base.where('status', filters.status);
    if (filters.protocol) base.where('protocol', filters.protocol);
    if (filters.manufacturer) base.where('manufacturer', filters.manufacturer);
    if (filters.imei) base.whereILike('imei', `%${filters.imei}%`);
    if (filters.search) {
      const term = `%${filters.search}%`;
      base.where((b) =>
        b
          .whereILike('imei', term)
          .orWhereILike('serial_number', term)
          .orWhereILike('model', term)
          .orWhereILike('manufacturer', term),
      );
    }
    if (filters.vehicleId) {
      // Devices currently bound to the given vehicle.
      base.whereRaw(
        'id IN (SELECT device_id FROM fleet.vehicle_devices WHERE vehicle_id = ?::uuid)',
        [filters.vehicleId],
      );
    }
    // Sprint E: include the bound vehicle on every list row so the dashboard can
    // join device connection state (gps-engine) onto vehicles WITHOUT a second
    // request per device. Scalar subquery (not a join): fleet.vehicle_devices
    // shares column names (tenant_id/created_at/…) with devices, and a join
    // would make listPaginated's unqualified `created_at` ORDER BY ambiguous.
    base.select(
      'devices.*',
      this.knex.raw(
        '(SELECT vd.vehicle_id FROM fleet.vehicle_devices vd WHERE vd.device_id = devices.id LIMIT 1) as vehicle_id',
      ),
    );
    return listPaginated<DeviceRow>(base, opts);
  }

  /** Row counts per lifecycle status for the tenant (Sprint E dashboard summary). */
  public async countByStatus(tenantId: string): Promise<Record<string, number>> {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .select('status')
      .count<{ status: string; count: string | number }[]>({ count: '*' })
      .groupBy('status');
    const out: Record<string, number> = {};
    for (const row of rows) out[row.status] = Number(row.count);
    return out;
  }

  // --- Cross-tenant resolution (device-gateway) -----------------------------

  /**
   * Resolve an IMEI to trusted device identity, CROSS-TENANT (IMEI is global).
   * Used by the resolve endpoint. Joins the owning tenant (active check) and the
   * current binding (vehicle). Never throws — a missing/odd row is `{found:false}`.
   */
  public async resolveByImei(imei: string): Promise<DeviceResolution> {
    // Cross-schema join (fleet.devices + fleet.vehicle_devices + iam.tenants).
    // Use fully-qualified names WITHOUT withSchema() — withSchema() would prepend
    // `fleet.` again and produce `fleet.fleet.vehicle_devices` (cross-db ref error).
    const row = await this.knex
      .from('fleet.devices as d')
      .leftJoin('fleet.vehicle_devices as vd', 'vd.device_id', 'd.id')
      .leftJoin('iam.tenants as t', 't.id', 'd.tenant_id')
      .where('d.imei', imei)
      .select<ResolveRow[]>(
        'd.id as id',
        'd.tenant_id as tenant_id',
        'd.status as status',
        'd.protocol as protocol',
        'vd.vehicle_id as vehicle_id',
        't.status as tenant_status',
      )
      .first();
    if (!row) return { found: false, tenantActive: false };
    const tenantActive = row.tenant_status === 'ACTIVE';
    const device: ResolvedDevice = {
      deviceId: row.id,
      tenantId: row.tenant_id,
      status: row.status,
      protocol: row.protocol,
      vehicleId: row.vehicle_id,
    };
    return { found: true, device, tenantActive };
  }

  // --- Writes (transactional; service owns the transaction) -----------------

  public async create(
    trx: Knex.Transaction,
    tenantId: string,
    input: {
      imei: string;
      serialNumber?: string | null;
      manufacturer?: string | null;
      model?: string | null;
      protocol: Protocol;
      status: DeviceStatus;
    },
  ): Promise<DeviceRow> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        tenant_id: trx.raw('?::uuid', [tenantId]),
        imei: input.imei,
        serial_number: input.serialNumber ?? null,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        protocol: input.protocol,
        status: input.status,
      })
      .returning('*');
    return row as DeviceRow;
  }

  public async update(
    trx: Knex.Transaction,
    tenantId: string,
    id: string,
    patch: {
      serialNumber?: string | null;
      manufacturer?: string | null;
      model?: string | null;
      protocol?: Protocol;
    },
    expectedVersion: number,
  ): Promise<DeviceRow | null> {
    const updates: Record<string, unknown> = {
      serial_number: patch.serialNumber ?? null,
      manufacturer: patch.manufacturer ?? null,
      model: patch.model ?? null,
      updated_at: trx.fn.now(),
      version: trx.raw('version + 1'),
    };
    if (patch.protocol) updates.protocol = patch.protocol;
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .where('version', expectedVersion)
      .update(updates)
      .returning('*');
    return (row as DeviceRow | undefined) ?? null;
  }

  /** Lifecycle status transition (e.g. ACTIVE→SUSPENDED disable, →DECOMMISSIONED archive). */
  public async setStatus(
    trx: Knex.Transaction,
    tenantId: string,
    id: string,
    status: DeviceStatus,
    expectedVersion: number,
  ): Promise<DeviceRow | null> {
    const [row] = await trx
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [id])
      .where('version', expectedVersion)
      .update({ status, updated_at: trx.fn.now(), version: trx.raw('version + 1') })
      .returning('*');
    return (row as DeviceRow | undefined) ?? null;
  }

  /**
   * Project connection state from a gateway session-lifecycle event onto the
   * device row (§21). Tenant-scoped by the event's tenantId; idempotent on the
   * transition timestamps. NOT called per packet — the gateway only emits
   * AUTHENTICATED/ACTIVE/DISCONNECTED transitions.
   */
  public async applyConnectionState(
    tenantId: string,
    deviceId: string,
    fields: {
      readonly lastSeenAt: Date;
      readonly connectedAt?: Date | null;
      readonly disconnectedAt?: Date | null;
    },
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      last_seen_at: fields.lastSeenAt,
      updated_at: this.knex.fn.now(),
    };
    if (fields.connectedAt) updates.connected_at = fields.connectedAt;
    if (fields.disconnectedAt) updates.disconnected_at = fields.disconnectedAt;
    await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [deviceId])
      .update(updates);
  }

  public static toRecord(row: DeviceRow): DeviceRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      imei: row.imei as DeviceRecord['imei'],
      serialNumber: row.serial_number,
      manufacturer: row.manufacturer,
      model: row.model,
      protocol: row.protocol,
      status: row.status,
      vehicleId: row.vehicle_id ?? null,
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
      connectedAt: row.connected_at ? new Date(row.connected_at) : null,
      disconnectedAt: row.disconnected_at ? new Date(row.disconnected_at) : null,
      version: row.version,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

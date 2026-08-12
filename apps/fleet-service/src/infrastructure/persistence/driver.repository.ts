/**
 * Driver repository — CRUD for fleet.drivers. Tenant-scoped (RLS enforced).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withPlatformContext, withTenantContext } from '@fleetvision/persistence-knex';
import { type Page, toCursor } from '@fleetvision/shared-kernel';
import { type Driver, Driver as DriverClass, type DriverStatus } from '../../domain/index.js';

export interface DriverRow {
  id: string;
  tenant_id: string;
  employee_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  license_number: string;
  license_class: string | null;
  license_issued: Date | null;
  license_expires: Date | null;
  license_country: string | null;
  status: DriverStatus;
  assigned_vehicle_id: string | null;
  assigned_at: Date | null;
  metadata: Record<string, unknown> | string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class DriverRepository {
  constructor(
    private readonly knex: Knex,
    private readonly platformKnex: Knex,
  ) {}

  public async create(driver: Driver): Promise<void> {
    await withTenantContext(this.knex, driver.tenantId, async (trx) => {
      await trx('fleet.drivers').insert({
        id: driver.id,
        tenant_id: driver.tenantId,
        employee_id: driver.employeeId,
        first_name: driver.firstName,
        last_name: driver.lastName,
        email: driver.email,
        phone: driver.phone,
        license_number: driver.licenseNumber,
        license_class: driver.licenseClass,
        license_issued: driver.licenseIssued,
        license_expires: driver.licenseExpires,
        license_country: driver.licenseCountry,
        status: driver.status,
        assigned_vehicle_id: driver.assignedVehicleId,
        assigned_at: driver.assignedAt,
        metadata: JSON.stringify(driver.metadata),
      });
    });
  }

  public async findById(tenantId: string, id: string): Promise<Driver | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx<DriverRow>('fleet.drivers').where({ id, tenant_id: tenantId }).first();
      return row ? this.toDomain(row) : null;
    });
  }

  public async listPage(
    tenantId: string,
    limit: number,
    status: DriverStatus | undefined,
    cursor?: { createdAt: string; id: string },
  ): Promise<Page<Driver>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      let query = trx<DriverRow>('fleet.drivers').where({ tenant_id: tenantId });
      if (status) query = query.where({ status });
      if (cursor) {
        query = query.where((q) =>
          q
            .where('created_at', '<', cursor.createdAt)
            .orWhere((q2) =>
              q2.where('created_at', '=', cursor.createdAt).andWhere('id', '<', cursor.id),
            ),
        );
      }
      const rows = (await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit + 1)) as DriverRow[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        data: page.map((r) => this.toDomain(r)),
        nextCursor:
          hasMore && last ? toCursor('created_at', last.created_at.toISOString(), last.id) : null,
      };
    });
  }

  public async update(driver: Driver): Promise<void> {
    await withTenantContext(this.knex, driver.tenantId, async (trx) => {
      const updated = await trx('fleet.drivers')
        .where({ id: driver.id, tenant_id: driver.tenantId, version: driver.version })
        .update({
          employee_id: driver.employeeId,
          first_name: driver.firstName,
          last_name: driver.lastName,
          email: driver.email,
          phone: driver.phone,
          license_number: driver.licenseNumber,
          license_class: driver.licenseClass,
          license_issued: driver.licenseIssued,
          license_expires: driver.licenseExpires,
          license_country: driver.licenseCountry,
          status: driver.status,
          assigned_vehicle_id: driver.assignedVehicleId,
          assigned_at: driver.assignedAt,
          version: this.knex.raw('version + 1'),
          updated_at: this.knex.fn.now(),
        });
      if (updated === 0) throw new Error('Optimistic concurrency conflict on driver update.');
    });
  }

  /** Check if a vehicle is already assigned to another active driver (cross-tenant needs platform). */
  public async findActiveDriverForVehicle(
    tenantId: string,
    vehicleId: string,
  ): Promise<Driver | null> {
    return withPlatformContext(this.platformKnex, async (trx) => {
      const row = await trx<DriverRow>('fleet.drivers')
        .where({ tenant_id: tenantId, assigned_vehicle_id: vehicleId, status: 'ACTIVE' })
        .first();
      return row ? this.toDomain(row) : null;
    });
  }

  private toDomain(row: DriverRow): Driver {
    return DriverClass.rehydrate(row.id, row.version, {
      tenantId: row.tenant_id,
      employeeId: row.employee_id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      licenseNumber: row.license_number,
      licenseClass: row.license_class,
      licenseIssued: row.license_issued,
      licenseExpires: row.license_expires,
      licenseCountry: row.license_country,
      status: row.status,
      assignedVehicleId: row.assigned_vehicle_id,
      assignedAt: row.assigned_at,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    });
  }
}

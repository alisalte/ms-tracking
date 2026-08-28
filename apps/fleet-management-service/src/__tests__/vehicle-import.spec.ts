import type { Knex } from '@fleetvision/persistence-knex';
import { describe, expect, it } from '@jest/globals';
import type { ActorContext } from '../application/service-context.js';
import { VehicleService } from '../application/vehicle.service.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import type { FleetRepository, FleetRow } from '../infrastructure/persistence/fleet.repository.js';
import type {
  VehicleRepository,
  VehicleRow,
} from '../infrastructure/persistence/vehicle.repository.js';

const CTX: ActorContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  actorId: 'user-1',
  actorType: 'USER',
  requestId: null,
  ipAddress: null,
  userAgent: null,
};

const FLEET_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function fleetRow(overrides: Partial<FleetRow> = {}): FleetRow {
  return {
    id: FLEET_ID,
    tenant_id: CTX.tenantId,
    name: 'North Fleet',
    code: 'NORTH',
    description: null,
    status: 'ACTIVE',
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function vehicleRow(code: string): VehicleRow {
  return {
    id: `veh-${code}`,
    tenant_id: CTX.tenantId,
    fleet_id: FLEET_ID,
    name: code,
    code,
    plate: null,
    vin: null,
    status: 'ACTIVE',
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function makeService(opts?: { fleet?: FleetRow | null; uniqueFailOn?: string }) {
  const created: VehicleRow[] = [];
  const createdFleets: FleetRow[] = [];
  const fleets = {
    findById: async (_t: string, id: string) => {
      const extra = createdFleets.find((f) => f.id === id);
      if (extra) return extra;
      if (opts?.fleet === undefined) return fleetRow();
      return opts.fleet;
    },
    findByCode: async (_t: string, code: string) => {
      const extra = createdFleets.find((f) => f.code === code);
      if (extra) return extra;
      const f = opts?.fleet === undefined ? fleetRow() : opts.fleet;
      if (!f) return null;
      return f.code === code ? f : null;
    },
    list: async () => ({
      data: [
        ...(opts?.fleet === undefined ? [fleetRow()] : opts.fleet ? [opts.fleet] : []),
        ...createdFleets,
      ],
      nextCursor: null,
    }),
    create: async (_trx: unknown, _tenant: string, input: { name: string; code: string }) => {
      const row = fleetRow({ id: `fleet-${input.code}`, name: input.name, code: input.code });
      createdFleets.push(row);
      return row;
    },
  };
  const vehicles = {
    create: async (_trx: unknown, _tenant: string, input: { code: string; name: string }) => {
      if (opts?.uniqueFailOn && input.code === opts.uniqueFailOn) {
        const err = Object.assign(new Error('duplicate'), {
          code: '23505',
          constraint: 'fleet_vehicles_tenant_code_unique',
        });
        throw err;
      }
      const row = vehicleRow(input.code);
      created.push(row);
      return row;
    },
  };
  const audit = { append: async () => undefined };
  const trx = { raw: async () => [] };
  const knex = {
    transaction: async (fn: (trx: unknown) => Promise<unknown>) => fn(trx),
  } as unknown as Knex;

  const service = new VehicleService(
    knex,
    vehicles as unknown as VehicleRepository,
    fleets as unknown as FleetRepository,
    audit as unknown as AuditRepository,
  );
  return { service, created };
}

describe('VehicleService.importMany', () => {
  it('creates valid rows and auto-creates a missing fleet instead of aborting the batch', async () => {
    const { service, created } = makeService();
    const result = await service.importMany(CTX, [
      { row: 2, name: 'Truck A', code: 'V001', fleetCode: 'NORTH' },
      { row: 3, name: 'Truck B', code: 'V002', fleetCode: 'MISSING' },
      { row: 4, name: 'Truck C', code: 'V003', fleetCode: 'NORTH' },
    ]);

    expect(created.map((r) => r.code)).toEqual(['V001', 'V002', 'V003']);
    expect(result.created).toHaveLength(3);
    expect(result.failed).toEqual([]);
    expect(result.warnings.some((w) => w.error.includes('MISSING'))).toBe(true);
  });

  it('matches a Unicode dash in the spreadsheet to an ASCII fleet code', async () => {
    const { service, created } = makeService({ fleet: fleetRow({ code: 'FLEET-01' }) });
    const result = await service.importMany(CTX, [
      { row: 2, name: 'Truck A', code: 'V001', fleetCode: 'FLEET\u201301' },
    ]);
    expect(result.failed).toEqual([]);
    expect(created).toHaveLength(1);
  });

  it('creates the fleet when the spreadsheet code does not exist yet', async () => {
    const { service } = makeService({ fleet: null });
    const result = await service.importMany(CTX, [
      { row: 2, name: 'Truck A', code: 'V001', fleetCode: 'FLEET-01' },
      { row: 3, name: 'Truck B', code: 'V002', fleetCode: 'FLEET-01' },
    ]);
    expect(result.created).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.error).toMatch(/FLEET-01/);
  });

  it('rejects an invalid fleet code that cannot be used as a registry code', async () => {
    const { service, created } = makeService({ fleet: null });
    const result = await service.importMany(CTX, [
      { row: 2, name: 'Truck A', code: 'V001', fleetCode: '???' },
    ]);
    expect(created).toHaveLength(0);
    expect(result.failed[0]?.error).toMatch(/not a valid fleet code/i);
  });

  it('rejects an archived fleet without creating the vehicle', async () => {
    const { service, created } = makeService({ fleet: fleetRow({ status: 'ARCHIVED' }) });
    const result = await service.importMany(CTX, [
      { row: 2, name: 'Truck A', code: 'V001', fleetCode: 'NORTH' },
    ]);
    expect(created).toHaveLength(0);
    expect(result.failed[0]?.error).toMatch(/archived/i);
  });

  it('maps a duplicate code to a row-level conflict instead of failing the request', async () => {
    const { service } = makeService({ uniqueFailOn: 'V001' });
    const result = await service.importMany(CTX, [
      { row: 2, name: 'Truck A', code: 'V001', fleetCode: 'NORTH' },
      { row: 3, name: 'Truck B', code: 'V002', fleetCode: 'NORTH' },
    ]);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.code).toBe('V002');
    expect(result.failed[0]?.row).toBe(2);
    expect(result.failed[0]?.error).toMatch(/already exists/i);
  });
});

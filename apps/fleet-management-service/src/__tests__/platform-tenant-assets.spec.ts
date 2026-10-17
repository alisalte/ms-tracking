import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import {
  type PlatformDeviceAssignment,
  PlatformTenantAssetsService,
} from '../application/platform-tenant-assets.service.js';
import type { ActorContext } from '../application/service-context.js';
import type { DeviceRecord } from '../domain/device/device-types.js';
import type { FleetRecord } from '../domain/fleet/fleet-types.js';
import type { VehicleRecord } from '../domain/vehicle/vehicle-types.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FLEET_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_FLEET = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DEVICE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VEHICLE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const ctx: ActorContext = {
  tenantId: TENANT,
  actorId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  actorType: 'USER',
  requestId: 'req-1',
  ipAddress: null,
  userAgent: null,
};

function fleet(over: Partial<FleetRecord> = {}): FleetRecord {
  return {
    id: FLEET_ID,
    tenantId: TENANT,
    name: 'North',
    code: 'NORTH',
    description: null,
    status: 'ACTIVE',
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function device(over: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: DEVICE_ID,
    tenantId: TENANT,
    imei: '490154203237518' as DeviceRecord['imei'],
    serialNumber: null,
    manufacturer: 'Meitrack',
    model: null,
    protocol: 'meitrack',
    status: 'ACTIVE',
    vehicleId: null,
    lastSeenAt: null,
    connectedAt: null,
    disconnectedAt: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function vehicle(over: Partial<VehicleRecord> = {}): VehicleRecord {
  return {
    id: VEHICLE_ID,
    tenantId: TENANT,
    fleetId: OTHER_FLEET,
    name: 'Truck',
    code: 'V001',
    plate: 'ABC-123',
    vin: null,
    odometerKm: 10,
    engineHours: null,
    status: 'ACTIVE',
    version: 2,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

describe('PlatformTenantAssetsService', () => {
  const fleets = {
    create: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  };
  const vehicles = {
    create: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
    importMany: jest.fn(),
  };
  const devices = {
    get: jest.fn(),
    list: jest.fn(),
    resolve: jest.fn(),
    create: jest.fn(),
  };
  const bindings = {
    bind: jest.fn(),
    getVehicleOfDevice: jest.fn(),
  };
  let svc: PlatformTenantAssetsService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PlatformTenantAssetsService(
      fleets as never,
      vehicles as never,
      devices as never,
      bindings as never,
    );
  });

  it('creates a fleet in the path tenant, not the operator tenant', async () => {
    fleets.create.mockImplementation(async () => fleet());
    await svc.createFleet(ctx, { name: 'North', code: 'NORTH' });
    expect(fleets.create).toHaveBeenCalledWith(ctx, { name: 'North', code: 'NORTH' });
    expect(ctx.tenantId).toBe(TENANT);
  });

  it('follows the cursor when listing fleets', async () => {
    fleets.list
      .mockImplementationOnce(async () => ({ data: [fleet({ id: '1' })], nextCursor: 'c1' }))
      .mockImplementationOnce(async () => ({ data: [fleet({ id: '2' })], nextCursor: null }));
    const rows = await svc.listFleets(ctx);
    expect(rows.map((row) => row.id)).toEqual(['1', '2']);
    expect(fleets.list).toHaveBeenLastCalledWith(ctx, {}, { cursor: 'c1', limit: 200 });
  });

  it('joins each device to its vehicle fleet', async () => {
    devices.list.mockImplementation(async () => ({
      data: [device({ vehicleId: VEHICLE_ID }), device({ id: 'unbound', vehicleId: null })],
      nextCursor: null,
    }));
    vehicles.list.mockImplementation(async () => ({
      data: [vehicle({ fleetId: FLEET_ID })],
      nextCursor: null,
    }));
    fleets.list.mockImplementation(async () => ({ data: [fleet()], nextCursor: null }));
    const rows = await svc.listDevices(ctx);
    expect(rows[0]).toMatchObject({ fleetId: FLEET_ID, fleetName: 'North', fleetCode: 'NORTH' });
    expect(rows[1]).toMatchObject({ fleetId: null, fleetName: null });
  });

  it('creates a vehicle and binds an unbound Meitrack as tracker and camera', async () => {
    devices.get.mockImplementation(async () => device());
    fleets.get.mockImplementation(async () => fleet());
    bindings.getVehicleOfDevice.mockImplementation(async () => null);
    vehicles.create.mockImplementation(async () => vehicle({ id: VEHICLE_ID, fleetId: FLEET_ID }));
    bindings.bind.mockImplementation(async () => ({}));

    const result: PlatformDeviceAssignment = await svc.assignDeviceToFleet(
      ctx,
      DEVICE_ID,
      FLEET_ID,
    );

    expect(vehicles.create).toHaveBeenCalledWith(ctx, {
      fleetId: FLEET_ID,
      name: 'Device 490154203237518',
      code: 'D490154203237518',
    });
    expect(bindings.bind).toHaveBeenCalledWith(ctx, VEHICLE_ID, DEVICE_ID, {
      roles: ['TRACKER', 'MDVR'],
      isPrimary: true,
    });
    expect(result).toMatchObject({
      deviceId: DEVICE_ID,
      vehicleId: VEHICLE_ID,
      fleetId: FLEET_ID,
      createdVehicle: true,
    });
  });

  it('retries the vehicle code when the IMEI code is already taken', async () => {
    devices.get.mockImplementation(async () => device({ protocol: 'gt06' }));
    fleets.get.mockImplementation(async () => fleet());
    bindings.getVehicleOfDevice.mockImplementation(async () => null);
    vehicles.create
      .mockImplementationOnce(async () => {
        throw new ConflictException('A vehicle with this code already exists in your tenant.');
      })
      .mockImplementationOnce(async () => vehicle({ fleetId: FLEET_ID }));
    bindings.bind.mockImplementation(async () => ({}));

    await svc.assignDeviceToFleet(ctx, DEVICE_ID, FLEET_ID);

    expect(vehicles.create).toHaveBeenNthCalledWith(2, ctx, {
      fleetId: FLEET_ID,
      name: 'Device 490154203237518',
      code: 'D490154203237518-dddddddd',
    });
    expect(bindings.bind).toHaveBeenCalledWith(ctx, VEHICLE_ID, DEVICE_ID, {
      roles: ['TRACKER'],
      isPrimary: true,
    });
  });

  it('moves an already-bound vehicle onto the chosen fleet', async () => {
    devices.get.mockImplementation(async () => device({ vehicleId: VEHICLE_ID }));
    fleets.get.mockImplementation(async () => fleet());
    bindings.getVehicleOfDevice.mockImplementation(async () => ({ vehicleId: VEHICLE_ID }));
    vehicles.get.mockImplementation(async () => vehicle());
    vehicles.update.mockImplementation(async () => vehicle({ fleetId: FLEET_ID }));

    const result = await svc.assignDeviceToFleet(ctx, DEVICE_ID, FLEET_ID);

    expect(vehicles.create).not.toHaveBeenCalled();
    expect(vehicles.update).toHaveBeenCalledWith(ctx, VEHICLE_ID, {
      fleetId: FLEET_ID,
      name: 'Truck',
      code: 'V001',
      plate: 'ABC-123',
      vin: undefined,
      odometerKm: 10,
      engineHours: null,
    });
    expect(result.createdVehicle).toBe(false);
  });

  it('leaves a device that is already on the fleet', async () => {
    devices.get.mockImplementation(async () => device({ vehicleId: VEHICLE_ID }));
    fleets.get.mockImplementation(async () => fleet());
    bindings.getVehicleOfDevice.mockImplementation(async () => ({ vehicleId: VEHICLE_ID }));
    vehicles.get.mockImplementation(async () => vehicle({ fleetId: FLEET_ID }));

    const result = await svc.assignDeviceToFleet(ctx, DEVICE_ID, FLEET_ID);

    expect(vehicles.update).not.toHaveBeenCalled();
    expect(vehicles.create).not.toHaveBeenCalled();
    expect(result.vehicleId).toBe(VEHICLE_ID);
  });

  it('rejects an archived fleet and a decommissioned device', async () => {
    devices.get.mockImplementation(async () => device());
    fleets.get.mockImplementation(async () => fleet({ status: 'ARCHIVED' }));
    await expect(svc.assignDeviceToFleet(ctx, DEVICE_ID, FLEET_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );

    devices.get.mockImplementation(async () => device({ status: 'DECOMMISSIONED' }));
    await expect(svc.assignDeviceToFleet(ctx, DEVICE_ID, FLEET_ID)).rejects.toThrow(
      /Decommissioned/,
    );
  });

  it('claims an inbox IMEI into the path tenant', async () => {
    const inbox = {
      findByImei: jest.fn(async () => ({
        imei: '490154203237518',
        protocol: 'gt06',
        manufacturer: 'Teltonika',
        model: null,
        seenCount: 3,
        firstSeenAt: new Date('2026-06-01T00:00:00Z'),
        lastSeenAt: new Date('2026-06-02T00:00:00Z'),
        claimedTenantId: null,
        claimedDeviceId: null,
        claimedAt: null,
      })),
      markClaimed: jest.fn(async () => undefined),
      listUnclaimed: jest.fn(async () => []),
      record: jest.fn(),
    };
    const claimer = new PlatformTenantAssetsService(
      fleets as never,
      vehicles as never,
      devices as never,
      bindings as never,
      inbox as never,
    );
    devices.resolve.mockImplementation(async () => ({ found: false, tenantActive: true }));
    devices.create.mockImplementation(async () => device({ protocol: 'gt06' }));

    const result = await claimer.claimDevice(ctx, '490154203237518');

    expect(result).toEqual({ deviceId: DEVICE_ID, created: true, assignment: null });
    expect(devices.create).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ imei: '490154203237518', protocol: 'gt06', status: 'ACTIVE' }),
    );
    expect(inbox.markClaimed).toHaveBeenCalledWith('490154203237518', TENANT, DEVICE_ID);
  });

  it('refuses an IMEI that already belongs to another tenant', async () => {
    const claimer = new PlatformTenantAssetsService(
      fleets as never,
      vehicles as never,
      devices as never,
      bindings as never,
      { findByImei: jest.fn(), markClaimed: jest.fn() } as never,
    );
    devices.resolve.mockImplementation(async () => ({
      found: true,
      tenantActive: true,
      device: { deviceId: DEVICE_ID, tenantId: '99999999-9999-9999-9999-999999999999' },
    }));

    await expect(claimer.claimDevice(ctx, '490154203237518')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(devices.create).not.toHaveBeenCalled();
  });
});

/**
 * Platform-operator fleet setup for one customer tenant.
 *
 * The tenant still registers devices in Assets. The operator creates that
 * tenant's fleets here and places each device on a fleet. A device is not a
 * fleet member on its own: assignment moves the device's vehicle, or creates
 * a vehicle in the chosen fleet and binds the device.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DeviceRecord, DeviceRole } from '../domain/device/device-types.js';
import type { FleetRecord } from '../domain/fleet/fleet-types.js';
import type { VehicleRecord } from '../domain/vehicle/vehicle-types.js';
import type { BindingService } from './binding.service.js';
import type { DeviceService } from './device.service.js';
import type { FleetService } from './fleet.service.js';
import type { ActorContext } from './service-context.js';
import type { CreateFleetInput } from './validation/schemas.js';
import type { VehicleService } from './vehicle.service.js';

const PAGE_LIMIT = 200;
const MAX_PAGES = 50;

export interface PlatformDeviceRow {
  readonly id: string;
  readonly imei: string;
  readonly serialNumber: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly protocol: DeviceRecord['protocol'];
  readonly status: DeviceRecord['status'];
  readonly vehicleId: string | null;
  readonly fleetId: string | null;
  readonly fleetName: string | null;
  readonly fleetCode: string | null;
}

export interface PlatformDeviceAssignment {
  readonly deviceId: string;
  readonly vehicleId: string;
  readonly fleetId: string;
  readonly fleetName: string;
  readonly createdVehicle: boolean;
}

export class PlatformTenantAssetsService {
  constructor(
    private readonly fleets: FleetService,
    private readonly vehicles: VehicleService,
    private readonly devices: DeviceService,
    private readonly bindings: BindingService,
  ) {}

  public createFleet(ctx: ActorContext, input: CreateFleetInput): Promise<FleetRecord> {
    return this.fleets.create(ctx, input);
  }

  public listFleets(ctx: ActorContext): Promise<FleetRecord[]> {
    return this.collect<FleetRecord>((cursor) =>
      this.fleets.list(ctx, {}, { cursor, limit: PAGE_LIMIT }),
    );
  }

  public async listDevices(ctx: ActorContext): Promise<PlatformDeviceRow[]> {
    const [devices, vehicles, fleetRows] = await Promise.all([
      this.collect<DeviceRecord>((cursor) =>
        this.devices.list(ctx, {}, { cursor, limit: PAGE_LIMIT }),
      ),
      this.collect<VehicleRecord>((cursor) =>
        this.vehicles.list(ctx, {}, { cursor, limit: PAGE_LIMIT }),
      ),
      this.collect<FleetRecord>((cursor) =>
        this.fleets.list(ctx, {}, { cursor, limit: PAGE_LIMIT }),
      ),
    ]);
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
    const fleetById = new Map(fleetRows.map((f) => [f.id, f]));
    return devices.map((device) => {
      const vehicle = device.vehicleId ? vehicleById.get(device.vehicleId) : undefined;
      const fleet = vehicle ? fleetById.get(vehicle.fleetId) : undefined;
      return {
        id: device.id,
        imei: device.imei,
        serialNumber: device.serialNumber,
        manufacturer: device.manufacturer,
        model: device.model,
        protocol: device.protocol,
        status: device.status,
        vehicleId: device.vehicleId,
        fleetId: fleet?.id ?? null,
        fleetName: fleet?.name ?? null,
        fleetCode: fleet?.code ?? null,
      };
    });
  }

  public async assignDeviceToFleet(
    ctx: ActorContext,
    deviceId: string,
    fleetId: string,
  ): Promise<PlatformDeviceAssignment> {
    const device = await this.devices.get(ctx, deviceId);
    if (device.status === 'DECOMMISSIONED') {
      throw new BadRequestException('Decommissioned devices cannot be assigned to a fleet.');
    }
    const fleet = await this.fleets.get(ctx, fleetId);
    if (fleet.status === 'ARCHIVED') {
      throw new ConflictException('Archived fleets cannot receive devices.');
    }

    const bound = await this.bindings.getVehicleOfDevice(ctx, deviceId);
    if (bound) {
      const vehicle = await this.vehicles.get(ctx, bound.vehicleId);
      if (vehicle.fleetId === fleetId) {
        return assignment(device.id, vehicle.id, fleet, false);
      }
      const moved = await this.vehicles.update(ctx, vehicle.id, {
        fleetId,
        name: vehicle.name,
        code: vehicle.code,
        plate: vehicle.plate ?? undefined,
        vin: vehicle.vin ?? undefined,
        odometerKm: vehicle.odometerKm,
        engineHours: vehicle.engineHours,
      });
      return assignment(device.id, moved.id, fleet, false);
    }

    const vehicleId = await this.createVehicleForDevice(ctx, device, fleetId);
    const roles = rolesFor(device.protocol);
    try {
      await this.bindings.bind(ctx, vehicleId, device.id, { roles, isPrimary: true });
    } catch (err) {
      if (err instanceof ConflictException && /already bound/i.test(err.message)) {
        const again = await this.bindings.getVehicleOfDevice(ctx, device.id);
        if (!again) throw err;
        const vehicle = await this.vehicles.get(ctx, again.vehicleId);
        if (vehicle.fleetId !== fleetId) {
          await this.vehicles.update(ctx, vehicle.id, {
            fleetId,
            name: vehicle.name,
            code: vehicle.code,
            plate: vehicle.plate ?? undefined,
            vin: vehicle.vin ?? undefined,
            odometerKm: vehicle.odometerKm,
            engineHours: vehicle.engineHours,
          });
        }
        return assignment(device.id, vehicle.id, fleet, false);
      }
      if (err instanceof ConflictException && /primary/i.test(err.message)) {
        await this.bindings.bind(ctx, vehicleId, device.id, { roles, isPrimary: false });
        return assignment(device.id, vehicleId, fleet, true);
      }
      throw err;
    }
    return assignment(device.id, vehicleId, fleet, true);
  }

  private async createVehicleForDevice(
    ctx: ActorContext,
    device: DeviceRecord,
    fleetId: string,
  ): Promise<string> {
    const name = `Device ${device.imei}`.slice(0, 200);
    let last: unknown;
    for (const code of vehicleCodes(device)) {
      try {
        const vehicle = await this.vehicles.create(ctx, { fleetId, name, code });
        return vehicle.id;
      } catch (err) {
        last = err;
        if (!isCodeConflict(err)) throw err;
      }
    }
    throw last;
  }

  private async collect<T>(
    fetchPage: (
      cursor: string | undefined,
    ) => Promise<{ data: readonly T[]; nextCursor: string | null }>,
  ): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < MAX_PAGES; n += 1) {
      const page = await fetchPage(cursor);
      rows.push(...page.data);
      if (!page.nextCursor) return rows;
      cursor = page.nextCursor;
    }
    return rows;
  }
}

function assignment(
  deviceId: string,
  vehicleId: string,
  fleet: FleetRecord,
  createdVehicle: boolean,
): PlatformDeviceAssignment {
  return {
    deviceId,
    vehicleId,
    fleetId: fleet.id,
    fleetName: fleet.name,
    createdVehicle,
  };
}

function rolesFor(protocol: DeviceRecord['protocol']): DeviceRole[] {
  return protocol === 'meitrack' ? ['TRACKER', 'MDVR'] : ['TRACKER'];
}

function vehicleCodes(device: DeviceRecord): string[] {
  const base = `D${device.imei}`.slice(0, 64);
  const suffix = device.id.replace(/-/g, '').slice(0, 8);
  const alt = `${base}-${suffix}`.slice(0, 64);
  return alt === base ? [base] : [base, alt];
}

function isCodeConflict(err: unknown): boolean {
  return err instanceof ConflictException && /code/i.test(err.message);
}

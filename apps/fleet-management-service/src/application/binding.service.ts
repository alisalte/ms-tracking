import { type Knex, withTenantContext } from '@fleetvision/persistence-knex';
/**
 * BindingService — vehicle↔device bind/unbind use-cases (Sprint C §11, §26).
 *
 * Invariants enforced:
 *   - Cross-tenant binding is impossible: vehicle + device are loaded tenant-scoped,
 *     so a foreign-tenant id is a 404 (no enumeration oracle) and can never be bound.
 *   - A device is bound to at most one vehicle (DB unique + preemptive check).
 *   - A vehicle has at most one primary device (DB partial unique + preemptive check).
 *   - Bind/unbind is transactional with audit.
 * DELETE of a binding is a hard row delete (binding history lives in the audit log);
 * telemetry history is unaffected (tracking.vehicle_positions is keyed by device_id,
 * never FK'd to fleet.vehicle_devices).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { RegistryInvalidationPublisher } from '../infrastructure/cache/registry-invalidation-publisher.js';
import type { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import type { BoundDeviceView } from '../infrastructure/persistence/binding.repository.js';
import type { BindingRepository } from '../infrastructure/persistence/binding.repository.js';
import type { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import type { VehicleRepository } from '../infrastructure/persistence/vehicle.repository.js';
import type { ActorContext } from './service-context.js';
import type { BindDeviceInput } from './validation/schemas.js';

export class BindingService {
  constructor(
    private readonly knex: Knex,
    private readonly vehicles: VehicleRepository,
    private readonly devices: DeviceRepository,
    private readonly bindings: BindingRepository,
    private readonly audit: AuditRepository,
    /** Sprint D §11 — push-based gateway cache invalidation (best-effort). */
    private readonly invalidation: RegistryInvalidationPublisher | null = null,
  ) {}

  /**
   * Bind a device to a vehicle. Returns the device + binding view.
   * Rejects cross-tenant ids, duplicate bindings, and conflicting primaries.
   */
  public async bind(
    ctx: ActorContext,
    vehicleId: string,
    deviceId: string,
    input: BindDeviceInput,
  ): Promise<BoundDeviceView> {
    // Both must exist in the caller's tenant (cross-tenant ids → 404, no leak).
    const vehicle = await this.vehicles.findById(ctx.tenantId, vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    const device = await this.devices.findById(ctx.tenantId, deviceId);
    if (!device) throw new NotFoundException('Device not found.');

    const role = input.role ?? 'TRACKER';
    const isPrimary = input.isPrimary ?? true;

    const alreadyToThis = await this.bindings.findBinding(ctx.tenantId, vehicleId, deviceId);
    if (alreadyToThis) {
      throw new ConflictException('Device is already bound to this vehicle.');
    }
    const deviceBinding = await this.bindings.findBindingByDevice(ctx.tenantId, deviceId);
    if (deviceBinding) {
      throw new ConflictException('Device is already bound to another vehicle.');
    }
    if (isPrimary && (await this.bindings.hasPrimaryDevice(ctx.tenantId, vehicleId))) {
      throw new ConflictException('This vehicle already has a primary device.');
    }

    return await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      await this.bindings.bind(trx, ctx.tenantId, vehicleId, deviceId, role, isPrimary);
      await this.audit.append(trx, {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        action: 'device.bound',
        resourceType: 'vehicle_device',
        resourceId: deviceId, // uuid (resource_id is uuid; vehicle id carried in `after`)
        permission: null,
        outcome: 'SUCCESS',
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        before: null,
        after: { vehicleId, deviceId, role, isPrimary },
      });
      // Build the joined view from the device we already loaded (avoids a re-query).
      const view: BoundDeviceView = {
        deviceId: device.id,
        imei: device.imei,
        manufacturer: device.manufacturer,
        model: device.model,
        protocol: device.protocol,
        deviceStatus: device.status,
        role,
        isPrimary,
        boundAt: new Date(),
      };
      // Sprint D §11 — a binding change alters the trusted vehicleId the
      // gateway stamps onto telemetry; invalidate its cached resolution.
      this.invalidation?.invalidate(device.imei, 'device.binding-changed', ctx.tenantId);
      return view;
    });
  }

  /** Unbind a device from a vehicle. Idempotent-ish: 404 if the binding doesn't exist. */
  public async unbind(ctx: ActorContext, vehicleId: string, deviceId: string): Promise<void> {
    const vehicle = await this.vehicles.findById(ctx.tenantId, vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    const existing = await this.bindings.findBinding(ctx.tenantId, vehicleId, deviceId);
    if (!existing) throw new NotFoundException('Device is not bound to this vehicle.');

    await withTenantContext(this.knex, ctx.tenantId, async (trx) => {
      await this.bindings.unbind(trx, ctx.tenantId, vehicleId, deviceId);
      await this.audit.append(trx, {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        action: 'device.unbound',
        resourceType: 'vehicle_device',
        resourceId: deviceId,
        permission: null,
        outcome: 'SUCCESS',
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        before: { vehicleId, deviceId },
        after: null,
      });
    });
    // Sprint D §11 — the device no longer carries a vehicleId in resolutions.
    const device = await this.devices.findById(ctx.tenantId, deviceId);
    if (device) {
      this.invalidation?.invalidate(device.imei, 'device.binding-changed', ctx.tenantId);
    }
  }

  /** Devices currently bound to a vehicle (read). */
  public async listDevicesForVehicle(
    ctx: ActorContext,
    vehicleId: string,
  ): Promise<BoundDeviceView[]> {
    const vehicle = await this.vehicles.findById(ctx.tenantId, vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    return this.bindings.listDevicesForVehicle(ctx.tenantId, vehicleId);
  }

  /** The vehicle a device is currently bound to (read), or null. */
  public async getVehicleOfDevice(
    ctx: ActorContext,
    deviceId: string,
  ): Promise<{ vehicleId: string } | null> {
    const device = await this.devices.findById(ctx.tenantId, deviceId);
    if (!device) throw new NotFoundException('Device not found.');
    const binding = await this.bindings.findBindingByDevice(ctx.tenantId, deviceId);
    return binding ? { vehicleId: binding.vehicle_id } : null;
  }
}

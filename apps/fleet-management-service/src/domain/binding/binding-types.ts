/** Vehicle↔Device binding domain types (Sprint C §11). */
import type { DeviceRole } from '../device/device-types.js';

/**
 * A current binding row in fleet.vehicle_devices. The table holds CURRENT bindings
 * only (a device is bound to ≤1 vehicle; unique device_id). Binding history is
 * captured in the audit log (bind/unbind events), so there is no unbound_at column.
 */
export interface VehicleDeviceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly deviceId: string;
  readonly role: DeviceRole;
  /** All functions this unit provides on the vehicle (tracker + MDVR + …). */
  readonly roles: readonly DeviceRole[];
  readonly isPrimary: boolean;
  readonly boundAt: Date;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

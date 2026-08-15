/**
 * Map a PostgreSQL unique-violation (SQLSTATE 23505) to a 409 Conflict with a
 * clear, constraint-specific message. Used as the race-condition backstop behind
 * the service's preemptive existence checks. Non-23505 errors rethrow unchanged.
 */
import { ConflictException } from '@nestjs/common';

/** Known unique constraints → human-readable messages. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  fleet_fleets_tenant_code_unique: 'A fleet with this code already exists in your tenant.',
  fleet_vehicles_tenant_code_unique: 'A vehicle with this code already exists in your tenant.',
  fleet_vehicles_tenant_plate_unique: 'A vehicle with this plate already exists in your tenant.',
  fleet_vehicles_tenant_vin_unique: 'A vehicle with this VIN already exists in your tenant.',
  fleet_devices_imei_unique:
    'A device with this IMEI already exists (IMEI is globally unique across all tenants).',
  fleet_vehicle_devices_device_unique: 'This device is already bound to a vehicle.',
  fleet_vehicle_devices_one_primary_per_vehicle: 'This vehicle already has a primary device.',
};

/** Default message when the constraint is not in the known map. */
const DEFAULT_MESSAGE = 'The resource conflicts with an existing record.';

export function mapUniqueViolation(err: unknown): ConflictException {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== '23505') throw err;
  const message = (e.constraint && CONSTRAINT_MESSAGES[e.constraint]) ?? DEFAULT_MESSAGE;
  return new ConflictException(message);
}

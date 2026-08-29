import { describe, expect, it } from '@jest/globals';
import {
  IMPORT_MAX_ROWS,
  bindBodySchema,
  createDeviceSchema,
  createFleetSchema,
  createVehicleSchema,
  deviceStatusSchema,
  importDevicesBodySchema,
  importVehicleRowSchema,
  importVehiclesBodySchema,
  listQuerySchema,
} from '../application/validation/schemas.js';

/** Build a Luhn-valid 15-digit IMEI (test helper, mirrors imei.spec.ts). */
function validImei(prefix14: string): string {
  let sum = 0;
  let double = true;
  for (let i = prefix14.length - 1; i >= 0; i--) {
    let d = prefix14.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return `${prefix14}${(10 - (sum % 10)) % 10}`;
}

describe('validation schemas (§16, INV-I02)', () => {
  it('createFleetSchema accepts name + code and strips unknown fields', () => {
    const parsed = createFleetSchema.parse({
      name: 'North Ops',
      code: 'north-ops',
      extra: 'ignored',
    });
    expect(parsed.code).toBe('north-ops');
    expect(parsed.description).toBeUndefined();
    expect((parsed as { extra?: string }).extra).toBeUndefined();
  });

  it('createFleetSchema rejects an invalid code format', () => {
    const r = createFleetSchema.safeParse({ name: 'F', code: 'has spaces' });
    expect(r.success).toBe(false);
  });

  it('createVehicleSchema requires a valid fleetId (uuid) and accepts optional plate/vin', () => {
    const parsed = createVehicleSchema.parse({
      fleetId: '11111111-1111-1111-1111-111111111111',
      name: 'Truck 1',
      code: 'TRK-1',
    });
    expect(parsed.plate).toBeUndefined();
    expect(parsed.vin).toBeUndefined();
  });

  it('createVehicleSchema rejects a VIN containing forbidden letters (I/O/Q)', () => {
    const r = createVehicleSchema.safeParse({
      fleetId: '11111111-1111-1111-1111-111111111111',
      name: 'T',
      code: 'C',
      vin: 'ABCDEFIGH1234567',
    });
    expect(r.success).toBe(false);
  });

  it('createDeviceSchema accepts a valid IMEI (normalized) + protocol, defaults status ACTIVE', () => {
    const imei = validImei('35123456789012');
    const parsed = createDeviceSchema.parse({
      imei: `${imei.slice(0, 4)}-${imei.slice(4)}`, // formatted → normalized
      protocol: 'gt06',
    });
    expect(parsed.imei).toBe(imei); // normalized to 15 digits
    // status defaults in the SERVICE (not the schema); absent → undefined here.
    expect(parsed.status).toBeUndefined();
  });

  it('createDeviceSchema rejects an invalid IMEI', () => {
    const r = createDeviceSchema.safeParse({ imei: '123', protocol: 'gt06' });
    expect(r.success).toBe(false);
  });

  it('createDeviceSchema rejects an unsupported protocol', () => {
    const r = createDeviceSchema.safeParse({
      imei: validImei('35123456789012'),
      protocol: 'teltonika',
    });
    expect(r.success).toBe(false);
  });

  it('deviceStatusSchema accepts the four lifecycle states', () => {
    for (const s of ['ACTIVE', 'SUSPENDED', 'DECOMMISSIONED', 'UNPAIRED']) {
      expect(deviceStatusSchema.parse(s)).toBe(s);
    }
  });

  it('bindBodySchema allows an empty body (role/isPrimary optional)', () => {
    const parsed = bindBodySchema.parse({});
    expect(parsed.role).toBeUndefined();
    expect(parsed.isPrimary).toBeUndefined();
  });

  it('listQuerySchema coerces limit and caps it', () => {
    const parsed = listQuerySchema.parse({ limit: '25', cursor: 'abc' });
    expect(parsed.limit).toBe(25);
    expect(parsed.cursor).toBe('abc');
  });

  it('INV-I02: no schema accepts tenant_id from the body', () => {
    // Even if a caller smuggles tenant_id, it is stripped (not part of any schema).
    const parsed = createFleetSchema.parse({
      name: 'F',
      code: 'c',
      tenant_id: '11111111-1111-1111-1111-111111111111',
    });
    expect((parsed as { tenant_id?: string }).tenant_id).toBeUndefined();
  });

  it('createVehicleSchema accepts optional odometerKm and rejects a negative reading', () => {
    const parsed = createVehicleSchema.parse({
      fleetId: '11111111-1111-1111-1111-111111111111',
      name: 'Truck 1',
      code: 'TRK-1',
      odometerKm: '12500.5',
    });
    expect(parsed.odometerKm).toBe(12500.5);
    const bad = createVehicleSchema.safeParse({
      fleetId: '11111111-1111-1111-1111-111111111111',
      name: 'T',
      code: 'C',
      odometerKm: -1,
    });
    expect(bad.success).toBe(false);
  });

  it('createVehicleSchema accepts optional engineHours and rejects a negative reading', () => {
    const parsed = createVehicleSchema.parse({
      fleetId: '11111111-1111-1111-1111-111111111111',
      name: 'Loader 1',
      code: 'LDR-1',
      engineHours: '12500.5',
    });
    expect(parsed.engineHours).toBe(12500.5);
    const bad = createVehicleSchema.safeParse({
      fleetId: '11111111-1111-1111-1111-111111111111',
      name: 'L',
      code: 'C',
      engineHours: -1,
    });
    expect(bad.success).toBe(false);
  });

  it('importVehicleRowSchema requires fleetCode instead of fleetId', () => {
    const parsed = importVehicleRowSchema.parse({
      name: 'Truck 1',
      code: 'TRK-1',
      fleetCode: 'NORTH',
    });
    expect(parsed.fleetCode).toBe('NORTH');
  });

  it('importVehiclesBodySchema rejects more than IMPORT_MAX_ROWS', () => {
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => ({ name: 'x' }));
    const r = importVehiclesBodySchema.safeParse({ rows });
    expect(r.success).toBe(false);
  });

  it('importDevicesBodySchema accepts a single row envelope', () => {
    const parsed = importDevicesBodySchema.parse({
      rows: [{ imei: validImei('35123456789012'), protocol: 'gt06' }],
    });
    expect(parsed.rows).toHaveLength(1);
  });
});

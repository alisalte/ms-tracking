import { describe, expect, it } from 'vitest';

import { buildVehiclesExportGrid } from '@/lib/asset-export';
import {
  ASSET_IMPORT_MAX_ROWS,
  buildAssetImportTemplate,
  parseAssetImportFile,
  parseDeviceGrid,
  parseDriverGrid,
  parseSpreadsheetDate,
  parseVehicleGrid,
} from '@/lib/asset-import';
import { buildXlsx, parseCsv, parseTabularFile } from '@/lib/spreadsheet';

describe('parseCsv', () => {
  it('parses comma CSV and strips a UTF-8 BOM', () => {
    const rows = parseCsv('\uFEFFname,code,fleetCode\nTruck,V001,NORTH\n');
    expect(rows[0]).toEqual(['name', 'code', 'fleetCode']);
    expect(rows[1]).toEqual(['Truck', 'V001', 'NORTH']);
  });

  it('uses semicolon when that is the Excel locale delimiter', () => {
    const rows = parseCsv('name;code;fleetCode\nA;B;C');
    expect(rows[1]).toEqual(['A', 'B', 'C']);
  });

  it('keeps quoted commas', () => {
    const rows = parseCsv('name,code\n"Acme, Inc",V1');
    expect(rows[1]).toEqual(['Acme, Inc', 'V1']);
  });
});

describe('parseVehicleGrid', () => {
  it('maps English and Persian headers', () => {
    const parsed = parseVehicleGrid([
      ['نام', 'کد', 'کد ناوگان', 'پلاک'],
      ['کامیون یک', 'V001', 'NORTH', '12A345'],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      row: 2,
      name: 'کامیون یک',
      code: 'V001',
      fleetCode: 'NORTH',
      plate: '12A345',
    });
  });

  it('maps odometer from English, Persian, and Eastern-Arabic digits', () => {
    const parsed = parseVehicleGrid([
      ['name', 'code', 'fleetCode', 'کارکرد'],
      ['Truck', 'V001', 'NORTH', '۴۸۲۱۰'],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]?.odometerKm).toBe(48210);
  });

  it('maps hour-meter from Persian کانتر / ساعت موتور', () => {
    const parsed = parseVehicleGrid([
      ['name', 'code', 'fleetCode', 'کانتر'],
      ['Loader', 'L001', 'NORTH', '۱۲۵۰۰'],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]?.engineHours).toBe(12500);
  });

  it('flags a negative odometer', () => {
    const parsed = parseVehicleGrid([
      ['name', 'code', 'fleetCode', 'odometerKm'],
      ['Truck', 'V001', 'NORTH', '-12'],
    ]);
    expect(parsed.issues.some((i) => i.code === 'invalidOdometer')).toBe(true);
  });

  it('folds a Unicode dash in fleetCode to ASCII hyphen', () => {
    const parsed = parseVehicleGrid([
      ['name', 'code', 'fleetCode'],
      ['Truck', 'V001', 'FLEET\u201301'],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]?.fleetCode).toBe('FLEET-01');
  });

  it('flags missing fleetCode and invalid VIN', () => {
    const parsed = parseVehicleGrid([
      ['name', 'code', 'fleetCode', 'vin'],
      ['Truck', 'V001', '', 'ABCDEFIGH1234567'],
    ]);
    expect(parsed.issues.map((i) => i.code).sort()).toEqual(['invalidVin', 'missingFleetCode']);
  });

  it('accepts an omitted or short VIN', () => {
    const omitted = parseVehicleGrid([
      ['name', 'code', 'fleetCode'],
      ['Truck', 'V001', 'NORTH'],
    ]);
    expect(omitted.issues).toEqual([]);
    expect(omitted.rows[0]?.vin).toBeUndefined();

    const short = parseVehicleGrid([
      ['name', 'code', 'fleetCode', 'vin'],
      ['Truck', 'V001', 'NORTH', 'ABC123'],
    ]);
    expect(short.issues).toEqual([]);
    expect(short.rows[0]?.vin).toBe('ABC123');
  });
});

describe('parseDeviceGrid', () => {
  it('normalizes IMEI separators and protocol aliases', () => {
    const parsed = parseDeviceGrid([
      ['imei', 'protocol', 'vehicleCode'],
      ['4901-5420-3237-518', 'GT06', 'V001'],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      imei: '490154203237518',
      protocol: 'gt06',
      vehicleCode: 'V001',
    });
  });

  it('rejects a Luhn-invalid IMEI', () => {
    const parsed = parseDeviceGrid([
      ['imei', 'protocol'],
      ['123456789012345', 'meitrack'],
    ]);
    expect(parsed.issues.some((i) => i.code === 'imeiLuhn')).toBe(true);
  });
});

describe('parseDriverGrid', () => {
  it('maps English and Persian headers', () => {
    const parsed = parseDriverGrid([
      ['نام', 'نام خانوادگی', 'شماره گواهینامه', 'کد خودرو'],
      ['علی', 'کریمی', 'DL-1001', 'V001'],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      row: 2,
      firstName: 'علی',
      lastName: 'کریمی',
      licenseNumber: 'DL-1001',
      vehicleCode: 'V001',
    });
  });

  it('converts an Excel serial date to YYYY-MM-DD', () => {
    expect(parseSpreadsheetDate('44927').value).toBe('2023-01-01');
    const parsed = parseDriverGrid([
      ['firstName', 'lastName', 'licenseNumber', 'licenseIssued'],
      ['Ali', 'Karimi', 'DL-1', '44927'],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]?.licenseIssued).toBe('2023-01-01');
  });

  it('flags missing last name and a bad email', () => {
    const parsed = parseDriverGrid([
      ['firstName', 'lastName', 'licenseNumber', 'email'],
      ['Ali', '', 'DL-1', 'not-an-email'],
    ]);
    expect(parsed.issues.map((i) => i.code).sort()).toEqual(['invalidEmail', 'missingLastName']);
  });
});

describe('vehicle Excel export', () => {
  it('uses import-compatible headers including fleetCode', () => {
    const grid = buildVehiclesExportGrid(
      [
        {
          id: 'veh-1',
          tenantId: 't',
          fleetId: 'fleet-1',
          name: 'Truck One',
          code: 'V001',
          plate: 'ABC-123',
          vin: null,
          odometerKm: 10,
          engineHours: null,
          status: 'ACTIVE',
          version: 1,
          createdAt: '',
          updatedAt: '',
        },
      ],
      [
        {
          id: 'fleet-1',
          tenantId: 't',
          name: 'North',
          code: 'NORTH',
          description: null,
          status: 'ACTIVE',
          version: 1,
          createdAt: '',
          updatedAt: '',
        },
      ],
    );
    expect(grid[0]).toEqual([
      'name',
      'code',
      'fleetCode',
      'plate',
      'vin',
      'odometerKm',
      'engineHours',
      'status',
    ]);
    expect(grid[1]?.[2]).toBe('NORTH');
  });
});

describe('xlsx round-trip', () => {
  it('writes a template Excel file that parses back to the same grid', async () => {
    const { blob, filename } = buildAssetImportTemplate('vehicles');
    expect(filename).toBe('vehicles-import.xlsx');
    const grid = await parseTabularFile(blob, filename);
    expect(grid[0]).toEqual([
      'name',
      'code',
      'fleetCode',
      'plate',
      'vin',
      'odometerKm',
      'engineHours',
    ]);
    expect(grid[1]?.[2]).toBe('NORTH');
  });

  it('writes a drivers template Excel file that parses back', async () => {
    const { blob, filename } = buildAssetImportTemplate('drivers');
    expect(filename).toBe('drivers-import.xlsx');
    const parsed = await parseAssetImportFile(
      new File([blob], filename, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'drivers',
    );
    expect(parsed.kind).toBe('drivers');
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      firstName: 'Ali',
      lastName: 'Karimi',
      licenseNumber: 'DL-1001',
      vehicleCode: 'V001',
    });
  });

  it('parseAssetImportFile reads a generated workbook', async () => {
    const bytes = buildXlsx('Devices', [
      ['imei', 'protocol'],
      ['490154203237518', 'meitrack'],
    ]);
    const file = new File([bytes], 'devices.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const parsed = await parseAssetImportFile(file, 'devices');
    expect(parsed.kind).toBe('devices');
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ imei: '490154203237518', protocol: 'meitrack' });
  });

  it('caps the spreadsheet at ASSET_IMPORT_MAX_ROWS', () => {
    const header = ['name', 'code', 'fleetCode'];
    const data = Array.from({ length: ASSET_IMPORT_MAX_ROWS + 1 }, (_, i) => [
      `N${i}`,
      `C${i}`,
      'NORTH',
    ]);
    const parsed = parseVehicleGrid([header, ...data]);
    expect(parsed.issues.some((i) => i.code === 'maxRows')).toBe(true);
    expect(parsed.rows).toHaveLength(0);
  });
});

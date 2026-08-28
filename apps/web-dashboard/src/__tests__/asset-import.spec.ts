import { describe, expect, it } from 'vitest';

import {
  ASSET_IMPORT_MAX_ROWS,
  buildAssetImportTemplate,
  parseAssetImportFile,
  parseDeviceGrid,
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

describe('xlsx round-trip', () => {
  it('writes a template Excel file that parses back to the same grid', async () => {
    const { blob, filename } = buildAssetImportTemplate('vehicles');
    expect(filename).toBe('vehicles-import.xlsx');
    const grid = await parseTabularFile(blob, filename);
    expect(grid[0]).toEqual(['name', 'code', 'fleetCode', 'plate', 'vin']);
    expect(grid[1]?.[2]).toBe('NORTH');
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

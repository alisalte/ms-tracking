/**
 * Mock driver registry — used only when `?useMock=true` (Sprint E mock-gate).
 * Shaped like the real fleet-service Driver aggregate.
 */
import type { Driver } from '@/types/asset.types';

const TS = '2026-01-01T00:00:00.000Z';

export function mockDrivers(): Driver[] {
  return [
    {
      id: 'drv-1',
      tenantId: 'tenant-1',
      employeeId: 'EMP-001',
      firstName: 'Ali',
      lastName: 'Karimi',
      email: 'ali.karimi@fleet.local',
      phone: '+989121111111',
      licenseNumber: 'DL-1001',
      licenseClass: 'B',
      licenseIssued: '2020-01-15T00:00:00.000Z',
      licenseExpires: '2028-01-15T00:00:00.000Z',
      licenseCountry: 'IR',
      status: 'ACTIVE',
      assignedVehicleId: 'veh-1',
      assignedAt: TS,
      version: 1,
    },
    {
      id: 'drv-2',
      tenantId: 'tenant-1',
      employeeId: 'EMP-002',
      firstName: 'Sara',
      lastName: 'Nazari',
      email: 'sara.nazari@fleet.local',
      phone: '+989122222222',
      licenseNumber: 'DL-1002',
      licenseClass: 'C',
      licenseIssued: '2019-06-01T00:00:00.000Z',
      licenseExpires: '2027-06-01T00:00:00.000Z',
      licenseCountry: 'IR',
      status: 'ACTIVE',
      assignedVehicleId: null,
      assignedAt: null,
      version: 1,
    },
    {
      id: 'drv-3',
      tenantId: 'tenant-1',
      employeeId: 'EMP-003',
      firstName: 'Reza',
      lastName: 'Rostami',
      email: null,
      phone: null,
      licenseNumber: 'DL-1003',
      licenseClass: 'B',
      licenseIssued: null,
      licenseExpires: '2026-03-01T00:00:00.000Z',
      licenseCountry: 'IR',
      status: 'INACTIVE',
      assignedVehicleId: null,
      assignedAt: null,
      version: 1,
    },
  ];
}

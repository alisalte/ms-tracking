import { describe, expect, it } from '@jest/globals';
import { BusinessTrip } from '../domain/business-trip.js';
import { Driver } from '../domain/driver.js';
import {
  type DriverStatus,
  IllegalDriverTransitionError,
  IllegalTripTransitionError,
  type TripStatus,
  isValidDriverTransition,
  isValidTripTransition,
} from '../domain/fleet-types.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ── Driver domain tests ──

describe('Driver', () => {
  function makeDriver() {
    return Driver.create('d-1', {
      tenantId: TENANT,
      employeeId: 'EMP-001',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@fleet.com',
      phone: '+1234567890',
      licenseNumber: 'DL-12345',
      licenseClass: 'B',
      licenseIssued: new Date('2020-01-01'),
      licenseExpires: new Date('2030-01-01'),
      licenseCountry: 'US',
    });
  }

  it('starts ACTIVE', () => {
    expect(makeDriver().status).toBe('ACTIVE');
  });

  it('assigns + unassigns vehicle', () => {
    const d = makeDriver();
    d.assignVehicle('vehicle-1');
    expect(d.assignedVehicleId).toBe('vehicle-1');
    expect(d.assignedAt).not.toBeNull();
    d.unassignVehicle();
    expect(d.assignedVehicleId).toBeNull();
  });

  it('cannot assign vehicle when not ACTIVE', () => {
    const d = makeDriver();
    d.transitionTo('SUSPENDED');
    expect(() => d.assignVehicle('v1')).toThrow(IllegalDriverTransitionError);
  });

  it('transitions ACTIVE → INACTIVE', () => {
    const d = makeDriver();
    d.transitionTo('INACTIVE');
    expect(d.status).toBe('INACTIVE');
  });

  it('TERMINATED is terminal', () => {
    const d = makeDriver();
    d.transitionTo('TERMINATED');
    expect(() => d.transitionTo('ACTIVE')).toThrow(IllegalDriverTransitionError);
  });

  it('updateProfile changes fields', () => {
    const d = makeDriver();
    d.updateProfile({ firstName: 'Jane', phone: '+999' });
    expect(d.firstName).toBe('Jane');
    expect(d.phone).toBe('+999');
  });

  it('deactivate unassigns vehicle', () => {
    const d = makeDriver();
    d.assignVehicle('v1');
    d.transitionTo('INACTIVE');
    d.unassignVehicle();
    expect(d.assignedVehicleId).toBeNull();
  });
});

describe('isValidDriverTransition', () => {
  it('allows ACTIVE → INACTIVE, ACTIVE → SUSPENDED, any → TERMINATED', () => {
    expect(isValidDriverTransition('ACTIVE', 'INACTIVE')).toBe(true);
    expect(isValidDriverTransition('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(isValidDriverTransition('INACTIVE', 'ACTIVE')).toBe(true);
    expect(isValidDriverTransition('SUSPENDED', 'TERMINATED')).toBe(true);
  });
  it('rejects TERMINATED → anything', () => {
    expect(isValidDriverTransition('TERMINATED', 'ACTIVE' as DriverStatus)).toBe(false);
  });
});

// ── BusinessTrip domain tests ──

describe('BusinessTrip', () => {
  function makeTrip() {
    return BusinessTrip.create('t-1', {
      tenantId: TENANT,
      driverId: 'd-1',
      vehicleId: 'v-1',
      originLabel: 'Office',
      originLat: 35.7,
      originLng: 51.3,
      destinationLabel: 'Warehouse',
      destinationLat: 35.8,
      destinationLng: 51.4,
      purpose: 'Delivery',
      notes: 'Fragile cargo',
      plannedStart: new Date('2026-04-01T08:00:00Z'),
      plannedEnd: new Date('2026-04-01T12:00:00Z'),
    });
  }

  it('starts as PLANNED', () => {
    expect(makeTrip().status).toBe('PLANNED');
  });

  it('PLANNED → ACTIVE → COMPLETED', () => {
    const t = makeTrip();
    t.start();
    expect(t.status).toBe('ACTIVE');
    expect(t.actualStart).not.toBeNull();
    t.complete(42.5, 3600);
    expect(t.status).toBe('COMPLETED');
    expect(t.distanceKm).toBe(42.5);
    expect(t.durationSec).toBe(3600);
    expect(t.actualEnd).not.toBeNull();
  });

  it('PLANNED → CANCELLED', () => {
    const t = makeTrip();
    t.cancel();
    expect(t.status).toBe('CANCELLED');
  });

  it('ACTIVE → CANCELLED', () => {
    const t = makeTrip();
    t.start();
    t.cancel();
    expect(t.status).toBe('CANCELLED');
  });

  it('COMPLETED is terminal', () => {
    const t = makeTrip();
    t.start();
    t.complete();
    expect(() => t.cancel()).toThrow(IllegalTripTransitionError);
    expect(() => t.start()).toThrow(IllegalTripTransitionError);
  });

  it('CANCELLED is terminal', () => {
    const t = makeTrip();
    t.cancel();
    expect(() => t.start()).toThrow(IllegalTripTransitionError);
  });

  it('cannot start from COMPLETED', () => {
    const t = makeTrip();
    t.start();
    t.complete();
    expect(() => t.start()).toThrow(IllegalTripTransitionError);
  });

  it('updateDetails changes fields', () => {
    const t = makeTrip();
    t.updateDetails({ purpose: 'Maintenance', notes: 'Updated' });
    expect(t.purpose).toBe('Maintenance');
    expect(t.notes).toBe('Updated');
  });
});

describe('isValidTripTransition', () => {
  it('allows PLANNED → ACTIVE/CANCELLED, ACTIVE → COMPLETED/CANCELLED', () => {
    expect(isValidTripTransition('PLANNED', 'ACTIVE')).toBe(true);
    expect(isValidTripTransition('PLANNED', 'CANCELLED')).toBe(true);
    expect(isValidTripTransition('ACTIVE', 'COMPLETED')).toBe(true);
    expect(isValidTripTransition('ACTIVE', 'CANCELLED')).toBe(true);
  });
  it('rejects COMPLETED/CANCELLED → anything', () => {
    expect(isValidTripTransition('COMPLETED', 'PLANNED' as TripStatus)).toBe(false);
    expect(isValidTripTransition('CANCELLED', 'ACTIVE' as TripStatus)).toBe(false);
  });
});

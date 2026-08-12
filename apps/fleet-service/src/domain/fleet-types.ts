/**
 * Fleet domain types — Driver + Business Trip shared type definitions.
 */

// ── Driver ──

export type DriverStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TERMINATED';

export const DRIVER_STATUSES: readonly DriverStatus[] = [
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'TERMINATED',
];

/** Check whether a driver status transition is legal. */
export function isValidDriverTransition(from: DriverStatus, to: DriverStatus): boolean {
  if (from === to) return false;
  // TERMINATED is terminal — no transitions out.
  if (from === 'TERMINATED') return false;
  // All other transitions are valid (ACTIVE↔INACTIVE↔SUSPENDED, any→TERMINATED).
  return true;
}

// ── Business Trip ──

export type TripStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export const TRIP_STATUSES: readonly TripStatus[] = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

/** Check whether a business-trip status transition is legal. */
export function isValidTripTransition(from: TripStatus, to: TripStatus): boolean {
  if (from === to) return false;
  // COMPLETED and CANCELLED are terminal.
  if (from === 'COMPLETED' || from === 'CANCELLED') return false;
  // PLANNED → ACTIVE, PLANNED → CANCELLED, ACTIVE → COMPLETED, ACTIVE → CANCELLED.
  if (from === 'PLANNED' && (to === 'ACTIVE' || to === 'CANCELLED')) return true;
  if (from === 'ACTIVE' && (to === 'COMPLETED' || to === 'CANCELLED')) return true;
  return false;
}

// ── Domain errors ──

import { DomainError } from '@fleetvision/shared-kernel';

export class DriverNotFoundError extends DomainError {
  public readonly code = 'NOT_FOUND';
  constructor() {
    super('Driver not found.');
  }
}

export class BusinessTripNotFoundError extends DomainError {
  public readonly code = 'NOT_FOUND';
  constructor() {
    super('Business trip not found.');
  }
}

export class IllegalDriverTransitionError extends DomainError {
  public readonly code = 'BUSINESS_RULE_VIOLATION';
}

export class IllegalTripTransitionError extends DomainError {
  public readonly code = 'BUSINESS_RULE_VIOLATION';
}

export class VehicleAlreadyAssignedError extends DomainError {
  public readonly code = 'CONFLICT';
  constructor() {
    super('Vehicle is already assigned to another active driver.');
  }
}

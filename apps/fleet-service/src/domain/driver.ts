/**
 * Driver — the driver profile aggregate.
 *
 * Manages driver identity, license information, status lifecycle, and vehicle
 * assignment (one driver → one vehicle at a time). Status transitions are
 * validated against the legal transition table.
 */
import { randomUUID } from 'node:crypto';
import {
  type DriverStatus,
  IllegalDriverTransitionError,
  isValidDriverTransition,
} from './fleet-types.js';

export interface DriverProps {
  readonly tenantId: string;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  licenseNumber: string;
  licenseClass: string | null;
  licenseIssued: Date | null;
  licenseExpires: Date | null;
  licenseCountry: string | null;
  status: DriverStatus;
  assignedVehicleId: string | null;
  assignedAt: Date | null;
  metadata: Record<string, unknown>;
}

export class Driver {
  public readonly tenantId: string;
  public employeeId: string | null;
  public firstName: string;
  public lastName: string;
  public email: string | null;
  public phone: string | null;
  public licenseNumber: string;
  public licenseClass: string | null;
  public licenseIssued: Date | null;
  public licenseExpires: Date | null;
  public licenseCountry: string | null;
  public status: DriverStatus;
  public assignedVehicleId: string | null;
  public assignedAt: Date | null;
  public metadata: Record<string, unknown>;
  public version: number;
  public readonly id: string;

  private constructor(id: string, version: number, props: DriverProps) {
    this.id = id;
    this.version = version;
    this.tenantId = props.tenantId;
    this.employeeId = props.employeeId;
    this.firstName = props.firstName;
    this.lastName = props.lastName;
    this.email = props.email;
    this.phone = props.phone;
    this.licenseNumber = props.licenseNumber;
    this.licenseClass = props.licenseClass;
    this.licenseIssued = props.licenseIssued;
    this.licenseExpires = props.licenseExpires;
    this.licenseCountry = props.licenseCountry;
    this.status = props.status;
    this.assignedVehicleId = props.assignedVehicleId;
    this.assignedAt = props.assignedAt;
    this.metadata = props.metadata;
  }

  public static create(
    id: string | undefined,
    props: Omit<DriverProps, 'status' | 'assignedVehicleId' | 'assignedAt' | 'metadata'> & {
      metadata?: Record<string, unknown>;
    },
  ): Driver {
    return new Driver(id ?? randomUUID(), 1, {
      ...props,
      status: 'ACTIVE',
      assignedVehicleId: null,
      assignedAt: null,
      metadata: props.metadata ?? {},
    });
  }

  public static rehydrate(id: string, version: number, props: DriverProps): Driver {
    return new Driver(id, version, props);
  }

  /** Full name convenience getter. */
  public get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  /** Is the driver currently available for assignment? */
  public isAvailable(): boolean {
    return this.status === 'ACTIVE';
  }

  /** Transition the driver to a new status. */
  public transitionTo(newStatus: DriverStatus): void {
    if (!isValidDriverTransition(this.status, newStatus)) {
      throw new IllegalDriverTransitionError(
        `Cannot transition driver from ${this.status} to ${newStatus}.`,
      );
    }
    this.status = newStatus;
  }

  /** Assign a vehicle to this driver. */
  public assignVehicle(vehicleId: string): void {
    if (!this.isAvailable()) {
      throw new IllegalDriverTransitionError(
        `Cannot assign a vehicle to a driver in ${this.status} state.`,
      );
    }
    this.assignedVehicleId = vehicleId;
    this.assignedAt = new Date();
  }

  /** Unassign the current vehicle. */
  public unassignVehicle(): void {
    this.assignedVehicleId = null;
    this.assignedAt = null;
  }

  /** Update profile fields (name, email, phone, license info). */
  public updateProfile(
    changes: Partial<
      Pick<
        DriverProps,
        | 'employeeId'
        | 'firstName'
        | 'lastName'
        | 'email'
        | 'phone'
        | 'licenseNumber'
        | 'licenseClass'
        | 'licenseIssued'
        | 'licenseExpires'
        | 'licenseCountry'
      >
    >,
  ): void {
    if (changes.employeeId !== undefined) this.employeeId = changes.employeeId;
    if (changes.firstName !== undefined) this.firstName = changes.firstName;
    if (changes.lastName !== undefined) this.lastName = changes.lastName;
    if (changes.email !== undefined) this.email = changes.email;
    if (changes.phone !== undefined) this.phone = changes.phone;
    if (changes.licenseNumber !== undefined) this.licenseNumber = changes.licenseNumber;
    if (changes.licenseClass !== undefined) this.licenseClass = changes.licenseClass;
    if (changes.licenseIssued !== undefined) this.licenseIssued = changes.licenseIssued;
    if (changes.licenseExpires !== undefined) this.licenseExpires = changes.licenseExpires;
    if (changes.licenseCountry !== undefined) this.licenseCountry = changes.licenseCountry;
  }
}

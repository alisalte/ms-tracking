/**
 * BusinessTrip — a fleet-management entity built on top of GPS Engine data.
 *
 * This is NOT the GPS Engine's trip FSM (which segments raw movement). A
 * BusinessTrip is a planned or completed fleet trip: driver, vehicle, origin,
 * destination, purpose, and lifecycle (PLANNED → ACTIVE → COMPLETED/CANCELLED).
 */
import { randomUUID } from 'node:crypto';
import {
  IllegalTripTransitionError,
  type TripStatus,
  isValidTripTransition,
} from './fleet-types.js';

export interface BusinessTripProps {
  readonly tenantId: string;
  driverId: string | null;
  vehicleId: string | null;
  status: TripStatus;
  originLabel: string | null;
  originLat: number | null;
  originLng: number | null;
  destinationLabel: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  distanceKm: number;
  durationSec: number;
  purpose: string | null;
  notes: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
}

export class BusinessTrip {
  public readonly tenantId: string;
  public driverId: string | null;
  public vehicleId: string | null;
  public status: TripStatus;
  public originLabel: string | null;
  public originLat: number | null;
  public originLng: number | null;
  public destinationLabel: string | null;
  public destinationLat: number | null;
  public destinationLng: number | null;
  public distanceKm: number;
  public durationSec: number;
  public purpose: string | null;
  public notes: string | null;
  public plannedStart: Date | null;
  public plannedEnd: Date | null;
  public actualStart: Date | null;
  public actualEnd: Date | null;
  public version: number;
  public readonly id: string;

  private constructor(id: string, version: number, props: BusinessTripProps) {
    this.id = id;
    this.version = version;
    this.tenantId = props.tenantId;
    this.driverId = props.driverId;
    this.vehicleId = props.vehicleId;
    this.status = props.status;
    this.originLabel = props.originLabel;
    this.originLat = props.originLat;
    this.originLng = props.originLng;
    this.destinationLabel = props.destinationLabel;
    this.destinationLat = props.destinationLat;
    this.destinationLng = props.destinationLng;
    this.distanceKm = props.distanceKm;
    this.durationSec = props.durationSec;
    this.purpose = props.purpose;
    this.notes = props.notes;
    this.plannedStart = props.plannedStart;
    this.plannedEnd = props.plannedEnd;
    this.actualStart = props.actualStart;
    this.actualEnd = props.actualEnd;
  }

  public static create(
    id: string | undefined,
    props: Omit<
      BusinessTripProps,
      'status' | 'distanceKm' | 'durationSec' | 'actualStart' | 'actualEnd'
    > & { distanceKm?: number; durationSec?: number },
  ): BusinessTrip {
    return new BusinessTrip(id ?? randomUUID(), 1, {
      ...props,
      status: 'PLANNED',
      distanceKm: props.distanceKm ?? 0,
      durationSec: props.durationSec ?? 0,
      actualStart: null,
      actualEnd: null,
    });
  }

  public static rehydrate(id: string, version: number, props: BusinessTripProps): BusinessTrip {
    return new BusinessTrip(id, version, props);
  }

  /** Start the trip (PLANNED → ACTIVE). */
  public start(): void {
    if (!isValidTripTransition(this.status, 'ACTIVE')) {
      throw new IllegalTripTransitionError(`Cannot start a trip in ${this.status} state.`);
    }
    this.status = 'ACTIVE';
    this.actualStart = new Date();
  }

  /** Complete the trip (ACTIVE → COMPLETED). */
  public complete(distanceKm?: number, durationSec?: number): void {
    if (!isValidTripTransition(this.status, 'COMPLETED')) {
      throw new IllegalTripTransitionError(`Cannot complete a trip in ${this.status} state.`);
    }
    this.status = 'COMPLETED';
    this.actualEnd = new Date();
    if (distanceKm !== undefined) this.distanceKm = distanceKm;
    if (durationSec !== undefined) this.durationSec = durationSec;
  }

  /** Cancel the trip (PLANNED/ACTIVE → CANCELLED). */
  public cancel(): void {
    if (!isValidTripTransition(this.status, 'CANCELLED')) {
      throw new IllegalTripTransitionError(`Cannot cancel a trip in ${this.status} state.`);
    }
    this.status = 'CANCELLED';
  }

  /** Update editable fields. */
  public updateDetails(
    changes: Partial<
      Pick<
        BusinessTripProps,
        | 'driverId'
        | 'vehicleId'
        | 'originLabel'
        | 'destinationLabel'
        | 'purpose'
        | 'notes'
        | 'plannedStart'
        | 'plannedEnd'
      >
    >,
  ): void {
    Object.assign(this, changes);
  }
}

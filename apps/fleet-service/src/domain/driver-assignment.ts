/**
 * Driver↔vehicle assignment interval (history row).
 * Device is never stored here — resolve via vehicle binding at query time.
 */
export interface DriverAssignmentProps {
  tenantId: string;
  driverId: string;
  vehicleId: string;
  startedAt: Date;
  endedAt: Date | null;
  changedBy: string | null;
}

export class DriverAssignment {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly driverId: string;
  public readonly vehicleId: string;
  public readonly startedAt: Date;
  public readonly endedAt: Date | null;
  public readonly changedBy: string | null;

  private constructor(id: string, props: DriverAssignmentProps) {
    this.id = id;
    this.tenantId = props.tenantId;
    this.driverId = props.driverId;
    this.vehicleId = props.vehicleId;
    this.startedAt = props.startedAt;
    this.endedAt = props.endedAt;
    this.changedBy = props.changedBy;
  }

  public static rehydrate(id: string, props: DriverAssignmentProps): DriverAssignment {
    return new DriverAssignment(id, props);
  }

  public get isCurrent(): boolean {
    return this.endedAt === null;
  }
}

/** Pure helper: whether an assign/unassign should open a new history interval. */
export function shouldOpenAssignmentInterval(
  previousVehicleId: string | null,
  nextVehicleId: string | null,
): boolean {
  return nextVehicleId !== null && nextVehicleId !== previousVehicleId;
}

/** Pure helper: whether any open interval for this driver must be closed. */
export function shouldCloseOpenAssignment(
  previousVehicleId: string | null,
  nextVehicleId: string | null,
): boolean {
  if (previousVehicleId === null) return false;
  return previousVehicleId !== nextVehicleId;
}

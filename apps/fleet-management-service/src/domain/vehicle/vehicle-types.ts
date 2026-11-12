/** Vehicle domain types (Sprint C §7). */

/** Vehicle lifecycle status. DELETE = ARCHIVE (soft), never a hard delete (§27). */
export type VehicleStatus = 'ACTIVE' | 'ARCHIVED';

/** Machine type, defined once on the vehicle and reused by every haul route. */
export type MachineType = 'TRUCK' | 'SHOVEL';

/** Analog input of the tracker a sensor is wired to. */
export type IoSensorInput = 'ain1' | 'ain2' | 'ain3' | 'ain4';

/** What the sensor on an analog input measures. */
export type IoSensorKind = 'fuel' | 'temperature' | 'voltage';

/**
 * One analog sensor: which input it is on, what it measures and its calibration
 * (input voltage → value, piecewise linear). Fuel values are percent of the tank.
 */
export interface IoSensorConfig {
  readonly input: IoSensorInput;
  readonly kind: IoSensorKind;
  readonly label?: string;
  /** Tank volume, so a fuel percentage can also be shown in litres. */
  readonly tankLiters?: number;
  readonly points: ReadonlyArray<{ readonly v: number; readonly value: number }>;
}

export interface VehicleRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly fleetId: string;
  readonly name: string;
  readonly code: string;
  /** Registration / plate number (nullable: not every asset is road-registered). */
  readonly plate: string | null;
  /** Vehicle Identification Number (17-char ISO 3779 where applicable). */
  readonly vin: string | null;
  /** Operator-entered current odometer reading in kilometres (null = unknown). */
  readonly odometerKm: number | null;
  /** Operator-entered hour-meter (engine hours). Used by heavy equipment. */
  readonly engineHours: number | null;
  /** What the machine is on a mine haul route; null for ordinary vehicles. */
  readonly machineType: MachineType | null;
  /** Analog sensors wired to the tracker (empty when none are set up). */
  readonly ioSensors: readonly IoSensorConfig[];
  readonly status: VehicleStatus;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Full CCE parameter record and the CAN verdict.
 *
 * MD300 puts optional CAN IDs in the same CCE packet as GPS (CCE ID protocol
 * V1.0). They are omitted when the unit did not read them. Every decoded
 * record therefore carries the complete parameter map plus `can.present`,
 * so a later log or position row can say whether CAN arrived.
 */
import { type CceStatus, decodeCceStatus } from './meitrack.cce-status.js';

export interface CceParamView {
  readonly id: number;
  readonly value: Buffer;
}

/** Scaled CAN fields. A key is set only when that ID was in the packet. */
export interface CceCan {
  readonly present: boolean;
  readonly ids: readonly string[];
  readonly acceleratorPedalPct?: number;
  readonly fuelLevelPct?: number;
  readonly engineTorquePct?: number;
  readonly torqueAtSpeedPct?: number;
  readonly clutchPressed?: boolean;
  readonly tachographAnalysis?: boolean;
  readonly parkingBrakeOn?: boolean;
  readonly cruiseOn?: boolean;
  readonly tachographSpeedKph?: number;
  readonly wheelSpeedKph?: number;
  readonly rpm?: number;
  readonly coolantTempC?: number;
  readonly ambientTempC?: number;
  readonly totalFuelL?: number;
  readonly engineHours?: number;
  readonly highResDistanceM?: number;
  readonly highResFuelL?: number;
  readonly fuelRateLph?: number;
  readonly axleWeightKg?: number;
  readonly serviceDistanceKm?: number;
  readonly instantEconomyKmPerL?: number;
  readonly batteryVoltageV?: number;
  readonly coolantLevelPct?: number;
  readonly tripFuelL?: number;
}

export interface CceSnapshot {
  readonly event: number;
  readonly paramIds: readonly string[];
  readonly params: Readonly<Record<string, string>>;
  readonly can: CceCan;
  /** Every documented non-CAN ID, scaled (GPS, I/O, power, cell, sensors…). */
  readonly status: CceStatus;
}

/** First-packet and framed-CCE logs keep this many raw bytes (a live MD300 CCE is ~160). */
export const CCE_FRAME_LOG_BYTES = 512;

const CAN_IDS = [
  0x93, 0x94, 0x95, 0x96, 0x97, 0x9d, 0x9e, 0xa1, 0x91, 0x92, 0x99, 0x9c, 0x9f, 0x98, 0x9a, 0x9b,
  0xa0, 0xa2, 0xa3, 0xa4, 0xa5, 0xf825, 0xf826, 0xf827,
] as const;

export function hexId(id: number): string {
  const width = id > 0xff ? 4 : 2;
  return `0x${id.toString(16).padStart(width, '0')}`;
}

export function isCceSnapshot(value: unknown): value is CceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as { can?: { present?: unknown }; paramIds?: unknown };
  return typeof rec.can?.present === 'boolean' && Array.isArray(rec.paramIds);
}

/** Every parameter in one CCE record, plus the CAN reading (present or absent). */
export function snapshotCce(params: readonly CceParamView[]): CceSnapshot {
  const paramIds: string[] = [];
  const values: Record<string, string> = {};
  const byId = new Map<number, Buffer>();
  for (const param of params) {
    const key = hexId(param.id);
    paramIds.push(key);
    values[key] = param.value.toString('hex');
    byId.set(param.id, param.value);
  }
  const event = readU16(byId.get(0x40)) ?? readU8(byId.get(0x01)) ?? 0;
  return {
    event,
    paramIds,
    params: values,
    can: decodeCan(byId),
    status: decodeCceStatus(params),
  };
}

/**
 * One log line for a decoded record. `can=absent` means the packet was read
 * in full and none of the CAN IDs were in it.
 */
export function formatCceRecordLog(imei: string, type: string, snapshot: CceSnapshot): string {
  const joined = snapshot.paramIds.map((id) => `${id}=${snapshot.params[id] ?? ''}`).join(',');
  const params = joined.length > 700 ? `${joined.slice(0, 700)}…` : joined;
  return `CCE imei=${imei} type=${type} event=${snapshot.event} can=${formatCanLog(snapshot.can)} params=${params}`;
}

/** Raw framed bytes for the gateway log. Null when the frame is not CCE/CFF. */
export function formatCceFrameLog(payload: Buffer): string | null {
  const head = payload.subarray(0, Math.min(payload.length, 80)).toString('latin1');
  if (!head.includes(',CCE,') && !head.includes(',CFF,')) return null;
  const slice = payload.subarray(0, Math.min(payload.length, CCE_FRAME_LOG_BYTES));
  const more = payload.length > CCE_FRAME_LOG_BYTES ? ` truncatedFrom=${payload.length}` : '';
  return `CCE frame bytes=${payload.length}${more} hex=${slice.toString('hex')}`;
}

function formatCanLog(can: CceCan): string {
  if (!can.present) return 'absent';
  const parts = [`present ${can.ids.join(',')}`];
  const named: Array<[string, number | boolean | undefined]> = [
    ['pedal%', can.acceleratorPedalPct],
    ['fuel%', can.fuelLevelPct],
    ['torque%', can.engineTorquePct],
    ['torqueAtSpeed%', can.torqueAtSpeedPct],
    ['clutch', can.clutchPressed],
    ['tachoAnalysis', can.tachographAnalysis],
    ['parkBrake', can.parkingBrakeOn],
    ['cruise', can.cruiseOn],
    ['tachoKph', can.tachographSpeedKph],
    ['wheelKph', can.wheelSpeedKph],
    ['rpm', can.rpm],
    ['coolantC', can.coolantTempC],
    ['ambientC', can.ambientTempC],
    ['fuelL', can.totalFuelL],
    ['engHours', can.engineHours],
    ['distM', can.highResDistanceM],
    ['hiresFuelL', can.highResFuelL],
    ['fuelLph', can.fuelRateLph],
    ['axleKg', can.axleWeightKg],
    ['serviceKm', can.serviceDistanceKm],
    ['kmPerL', can.instantEconomyKmPerL],
    ['battV', can.batteryVoltageV],
    ['coolant%', can.coolantLevelPct],
    ['tripFuelL', can.tripFuelL],
  ];
  for (const [label, value] of named) {
    if (value !== undefined) parts.push(`${label}=${value}`);
  }
  return parts.join(' ');
}

function decodeCan(byId: ReadonlyMap<number, Buffer>): CceCan {
  const ids = CAN_IDS.filter((id) => byId.has(id)).map((id) => hexId(id));
  const can: {
    present: boolean;
    ids: string[];
    acceleratorPedalPct?: number;
    fuelLevelPct?: number;
    engineTorquePct?: number;
    torqueAtSpeedPct?: number;
    clutchPressed?: boolean;
    tachographAnalysis?: boolean;
    parkingBrakeOn?: boolean;
    cruiseOn?: boolean;
    tachographSpeedKph?: number;
    wheelSpeedKph?: number;
    rpm?: number;
    coolantTempC?: number;
    ambientTempC?: number;
    totalFuelL?: number;
    engineHours?: number;
    highResDistanceM?: number;
    highResFuelL?: number;
    fuelRateLph?: number;
    axleWeightKg?: number;
    serviceDistanceKm?: number;
    instantEconomyKmPerL?: number;
    batteryVoltageV?: number;
    coolantLevelPct?: number;
    tripFuelL?: number;
  } = { present: ids.length > 0, ids };

  const bit = (id: number): boolean | undefined => {
    const value = readU8(byId.get(id));
    return value === null ? undefined : value === 1;
  };
  can.clutchPressed = bit(0x93);
  can.tachographAnalysis = bit(0x94);
  can.parkingBrakeOn = bit(0x95);
  can.cruiseOn = bit(0x96);
  assign(can, 'acceleratorPedalPct', readU8(byId.get(0x97)));
  assign(can, 'fuelLevelPct', readU8(byId.get(0x9d)));
  assign(can, 'engineTorquePct', readS8(byId.get(0x9e)));
  assign(can, 'torqueAtSpeedPct', readU8(byId.get(0xa1)));
  assign(can, 'tachographSpeedKph', readU16(byId.get(0x91)));
  assign(can, 'wheelSpeedKph', readU16(byId.get(0x92)));
  assign(can, 'rpm', readU16(byId.get(0x99)));
  assign(can, 'coolantTempC', readS16(byId.get(0x9c)));
  assign(can, 'ambientTempC', readS16(byId.get(0x9f)));
  assign(can, 'totalFuelL', readU32(byId.get(0x98)));
  assign(can, 'engineHours', scale(readU32(byId.get(0x9a)), 10, 1));
  assign(can, 'highResDistanceM', readU32(byId.get(0x9b)));
  assign(can, 'highResFuelL', scale(readU32(byId.get(0xa0)), 1000, 3));
  assign(can, 'fuelRateLph', scale(readU32(byId.get(0xa2)), 100, 2));
  assign(can, 'axleWeightKg', scale(readU32(byId.get(0xa3)), 10, 1));
  assign(can, 'serviceDistanceKm', readS32(byId.get(0xa4)));
  assign(can, 'instantEconomyKmPerL', scale(readU32(byId.get(0xa5)), 1000, 3));
  assign(can, 'batteryVoltageV', scale(readU32(byId.get(0xf825)), 100, 2));
  assign(can, 'coolantLevelPct', scale(readU16(byId.get(0xf826)), 100, 2));
  // Formula is raw/100. The sample prose says 513 L for raw 513; the formula wins.
  assign(can, 'tripFuelL', scale(readU32(byId.get(0xf827)), 100, 2));

  for (const key of Object.keys(can) as Array<keyof typeof can>) {
    if (can[key] === undefined) delete can[key];
  }
  return can;
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null): void {
  if (value !== null && value !== undefined) target[key] = value;
}

function scale(raw: number | null, divisor: number, digits: number): number | null {
  if (raw === null) return null;
  const factor = 10 ** digits;
  return Math.round((raw / divisor) * factor) / factor;
}

function readU8(value: Buffer | undefined): number | null {
  if (!value || value.length < 1) return null;
  return value.readUInt8(0);
}

function readS8(value: Buffer | undefined): number | null {
  if (!value || value.length < 1) return null;
  return value.readInt8(0);
}

function readU16(value: Buffer | undefined): number | null {
  if (!value || value.length < 2) return null;
  return value.readUInt16LE(0);
}

function readS16(value: Buffer | undefined): number | null {
  if (!value || value.length < 2) return null;
  return value.readInt16LE(0);
}

function readU32(value: Buffer | undefined): number | null {
  if (!value || value.length < 4) return null;
  return value.readUInt32LE(0);
}

function readS32(value: Buffer | undefined): number | null {
  if (!value || value.length < 4) return null;
  return value.readInt32LE(0);
}

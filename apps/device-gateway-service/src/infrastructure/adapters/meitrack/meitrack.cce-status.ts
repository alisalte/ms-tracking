/**
 * Device status carried in a CCE record (MEITRACK GPRS (CCE ID) Protocol V1.0,
 * 2025-03-30, §1.1). Every parameter ID in that document that is not a CAN
 * reading (those live in `meitrack.cce-snapshot.ts`) is decoded here.
 *
 * A key is set only when its ID was in the packet. The n-byte values arrive
 * without their length byte (the group parser already consumed it).
 */
import type { CceParamView } from './meitrack.cce-snapshot.js';

export interface CceBaseStation {
  readonly mcc: number;
  readonly mnc: number;
  readonly lac: number;
  readonly cellId: number;
  readonly rxLevelDbm: number;
}

export interface CceTemperature {
  /** Parameter slot 1–8 (IDs 0x2A–0x31). */
  readonly slot: number;
  /** Sensor number reported inside the value. */
  readonly sensor: number;
  readonly celsius: number;
}

export interface CceNetwork {
  readonly version: number;
  /** 0 none, 1 mobile, 2 Wi-Fi, 3 LAN. */
  readonly type: number;
  readonly typeLabel: 'none' | 'mobile' | 'wifi' | 'lan' | 'unknown';
  readonly descriptor: string;
}

export interface CceCameras {
  readonly supported: number;
  /** 1-based channels whose bit is set in the access mask. */
  readonly connected: readonly number[];
}

export interface CceSpeedCurve {
  readonly intervalMs: number;
  readonly speedsKph: readonly number[];
}

export interface CceTyre {
  /** 0 = tractor, 1–4 = trailer N. */
  readonly axleGroup: number;
  readonly tyre: number;
  readonly sensorId: string;
  readonly pressureBar: number;
  readonly temperatureC: number;
  readonly lowBattery: boolean;
  readonly signalLost: boolean;
  readonly pressureHigh: boolean;
  readonly pressureLow: boolean;
  readonly temperatureHigh: boolean;
  readonly alert: 'none' | 'fast_leak' | 'slow_leak' | 'inflation';
}

export interface CcePeopleSensor {
  readonly sensor: number;
  readonly door: number;
  readonly state: number;
  readonly boarded: number;
  readonly alighted: number;
  readonly totalBoarded: number;
  readonly totalAlighted: number;
}

export interface CcePeopleCounter {
  readonly version: number;
  readonly sensors: readonly CcePeopleSensor[];
  readonly boarded: number;
  readonly alighted: number;
  readonly totalBoarded: number;
  readonly totalAlighted: number;
  readonly onBoard: number;
}

export interface CceStatus {
  readonly gpsValid?: boolean;
  readonly satellites?: number;
  readonly gsmSignal?: number;
  /** Bit N = output N+1. */
  readonly outputs?: number;
  /** Bit N = input N+1 (0x42 when present, else 0x15). */
  readonly inputs?: number;
  readonly geofence?: number;
  readonly temperatureSensorNo?: number;
  readonly deadReckoning?: boolean;
  readonly speedKph?: number;
  readonly headingDeg?: number;
  readonly hdop?: number;
  readonly altitudeM?: number;
  readonly ad1V?: number;
  readonly ad2V?: number;
  readonly ad3V?: number;
  readonly ad6V?: number;
  readonly batteryV?: number;
  readonly batteryPct?: number;
  readonly externalPowerV?: number;
  readonly fuelPct?: number;
  readonly gpsTime?: string;
  readonly mileageM?: number;
  readonly runTimeS?: number;
  readonly systemFlag?: number;
  readonly eep2Modified?: boolean;
  readonly rfid?: number;
  readonly baseStation?: CceBaseStation;
  readonly pictureName?: string;
  readonly temperatures?: readonly CceTemperature[];
  readonly network?: CceNetwork;
  readonly cameras?: CceCameras;
  readonly speedCurve?: CceSpeedCurve;
  readonly tyres?: readonly CceTyre[];
  readonly peopleCounter?: CcePeopleCounter;
}

/** CCE time origin: 2000-01-01 00:00:00 UTC. */
const EPOCH_2000_MS = Date.UTC(2000, 0, 1);

const TEMPERATURE_IDS = [0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31] as const;

export function decodeCceStatus(params: readonly CceParamView[]): CceStatus {
  const byId = new Map<number, Buffer>();
  for (const param of params) byId.set(param.id, param.value);
  const get = (id: number): Buffer | undefined => byId.get(id);

  const status: Record<string, unknown> = {};
  const put = (key: keyof CceStatus, value: unknown): void => {
    if (value !== null && value !== undefined) status[key] = value;
  };

  const gpsFlag = u8(get(0x05));
  put('gpsValid', gpsFlag === null ? null : gpsFlag === 1);
  put('satellites', u8(get(0x06)));
  put('gsmSignal', u8(get(0x07)));
  put('outputs', u8(get(0x14)));
  put('inputs', u32(get(0x42)) ?? u8(get(0x15)));
  // 0xFE90 is the 2-byte form of the geofence number on newer firmware.
  put('geofence', u16(get(0xfe90)) ?? u8(get(0x1b)));
  put('temperatureSensorNo', u8(get(0x27)));
  const dr = u8(get(0x5b));
  put('deadReckoning', dr === null ? null : dr === 1);

  put('speedKph', u16(get(0x08)));
  put('headingDeg', u16(get(0x09)));
  put('hdop', scale(u16(get(0x0a)), 10, 1));
  put('altitudeM', s16(get(0x0b)));
  put('ad1V', scale(u16(get(0x16)), 100, 2));
  put('ad2V', scale(u16(get(0x17)), 100, 2));
  put('ad3V', scale(u16(get(0x18)), 100, 2));
  put('ad6V', scale(u16(get(0x41)), 100, 2));
  const batteryRaw = u16(get(0x19));
  put('batteryV', scale(batteryRaw, 100, 2));
  // Full is 4.2 V and empty 3.4 V: (V − 3.4) / 0.8 × 100, clamped to 0–100.
  // Computed on the raw centivolts so 4.18 V is 97.5 → 98, not 97.4999….
  put(
    'batteryPct',
    batteryRaw === null
      ? null
      : Math.max(0, Math.min(100, Math.round(((batteryRaw - 340) / 80) * 100))),
  );
  put('externalPowerV', scale(u16(get(0x1a)), 100, 2));
  // Raw 3450 is documented as 34.50 % (the prose says "/10000" as a fraction).
  put('fuelPct', scale(u16(get(0x29)), 100, 2));

  const time = u32(get(0x04));
  put('gpsTime', time === null ? null : new Date(EPOCH_2000_MS + time * 1000).toISOString());
  put('mileageM', u32(get(0x0c)));
  put('runTimeS', u32(get(0x0d)));
  const flag = u32(get(0x1c));
  put('systemFlag', flag);
  put('eep2Modified', flag === null ? null : (flag & 0x01) === 1);
  put('rfid', u32(get(0x25)));

  put('baseStation', baseStation(get(0x0e)));
  put('pictureName', pictureName(get(0x28)));
  const temperatures = TEMPERATURE_IDS.flatMap((id, i) => {
    const t = temperature(get(id), i + 1);
    return t ? [t] : [];
  });
  put('temperatures', temperatures.length > 0 ? temperatures : null);
  put('network', network(get(0x4b)));
  put('cameras', cameras(get(0x49)));
  put('speedCurve', speedCurve(get(0xf824)));
  const tyres = [...tpms(get(0xfef2)), ...tpms(get(0xfef3))];
  put('tyres', tyres.length > 0 ? tyres : null);
  put('peopleCounter', peopleCounter(get(0xfe96)));

  return status as CceStatus;
}

/** 0x0E: MCC(2) MNC(2) LAC(2) CELL_ID(4) RX_LEVEL(s16). */
function baseStation(value: Buffer | undefined): CceBaseStation | null {
  if (!value || value.length < 12) return null;
  return {
    mcc: value.readUInt16LE(0),
    mnc: value.readUInt16LE(2),
    lac: value.readUInt16LE(4),
    cellId: value.readUInt32LE(6),
    rxLevelDbm: value.readInt16LE(10),
  };
}

/**
 * 0x28 (event 39): DWORD time since 2000 + DWORD file suffix.
 * Documented example → `130513024323_C1E01.jpg`.
 */
function pictureName(value: Buffer | undefined): string | null {
  if (!value || value.length < 8) return null;
  const at = new Date(EPOCH_2000_MS + value.readUInt32LE(0) * 1000);
  if (Number.isNaN(at.getTime())) return null;
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp =
    two(at.getUTCFullYear() % 100) +
    two(at.getUTCMonth() + 1) +
    two(at.getUTCDate()) +
    two(at.getUTCHours()) +
    two(at.getUTCMinutes()) +
    two(at.getUTCSeconds());
  const suffix = value.readUInt32LE(4).toString(16).toUpperCase();
  return `${stamp}_${suffix}.jpg`;
}

/** 0x2A–0x31: sensor number + signed °C × 100. */
function temperature(value: Buffer | undefined, slot: number): CceTemperature | null {
  if (!value || value.length < 3) return null;
  return {
    slot,
    sensor: value.readUInt8(0),
    celsius: Math.round(value.readInt16LE(1)) / 100,
  };
}

const NETWORK_TYPES = ['none', 'mobile', 'wifi', 'lan'] as const;

/** 0x4B: version, type, descriptor length, descriptor. */
function network(value: Buffer | undefined): CceNetwork | null {
  if (!value || value.length < 3) return null;
  const type = value.readUInt8(1);
  const len = Math.min(value.readUInt8(2), value.length - 3);
  return {
    version: value.readUInt8(0),
    type,
    typeLabel: NETWORK_TYPES[type] ?? 'unknown',
    descriptor: value
      .subarray(3, 3 + len)
      .toString('latin1')
      .replace(/\0+$/, ''),
  };
}

/** 0x49: supported camera count + little-endian access mask (bit 0 = CH1). */
function cameras(value: Buffer | undefined): CceCameras | null {
  if (!value || value.length < 1) return null;
  const connected: number[] = [];
  const mask = value.subarray(1);
  for (let byte = 0; byte < mask.length; byte++) {
    const b = mask[byte] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      if (b & (1 << bit)) connected.push(byte * 8 + bit + 1);
    }
  }
  return { supported: value.readUInt8(0), connected };
}

/** 0xF824 (events 129/130): count, interval ms, one km/h byte per sample. */
function speedCurve(value: Buffer | undefined): CceSpeedCurve | null {
  if (!value || value.length < 3) return null;
  const count = Math.min(value.readUInt8(0), value.length - 3);
  return {
    intervalMs: value.readUInt16LE(1),
    speedsKph: [...value.subarray(3, 3 + count)],
  };
}

const TYRE_ALERTS = ['none', 'fast_leak', 'slow_leak', 'inflation'] as const;
const TYRE_BYTES = 8;

/** 0xFEF2 / 0xFEF3: count, then 8-byte tyre records. */
function tpms(value: Buffer | undefined): CceTyre[] {
  if (!value || value.length < 1) return [];
  const count = value.readUInt8(0);
  const tyres: CceTyre[] = [];
  for (let i = 0; i < count; i++) {
    const off = 1 + i * TYRE_BYTES;
    if (off + TYRE_BYTES > value.length) break;
    const position = value.readUInt8(off);
    const status = value.readUInt8(off + 7);
    tyres.push({
      axleGroup: position >> 5,
      tyre: position & 0x1f,
      sensorId: value
        .subarray(off + 1, off + 4)
        .reverse()
        .toString('hex')
        .toUpperCase(),
      pressureBar: Math.round(value.readUInt16LE(off + 4) * 0.025 * 1000) / 1000,
      temperatureC: value.readUInt8(off + 6) - 50,
      lowBattery: (status & 0x80) !== 0,
      signalLost: (status & 0x40) !== 0,
      pressureHigh: (status & 0x10) !== 0,
      pressureLow: (status & 0x08) !== 0,
      temperatureHigh: (status & 0x04) !== 0,
      alert: TYRE_ALERTS[status & 0x03] ?? 'none',
    });
  }
  return tyres;
}

const PEOPLE_SENSOR_BYTES = 19;
const PEOPLE_TOTAL_BYTES = 20;

/** 0xFE96: version, 0–4 sensor records, then the all-sensors totals. */
function peopleCounter(value: Buffer | undefined): CcePeopleCounter | null {
  if (!value || value.length < 1 + PEOPLE_TOTAL_BYTES) return null;
  const sensorBytes = value.length - 1 - PEOPLE_TOTAL_BYTES;
  const count = Math.floor(sensorBytes / PEOPLE_SENSOR_BYTES);
  const sensors: CcePeopleSensor[] = [];
  for (let i = 0; i < count; i++) {
    const off = 1 + i * PEOPLE_SENSOR_BYTES;
    sensors.push({
      sensor: value.readUInt8(off),
      door: value.readUInt8(off + 1),
      state: value.readUInt8(off + 2),
      boarded: value.readUInt32LE(off + 3),
      alighted: value.readUInt32LE(off + 7),
      totalBoarded: value.readUInt32LE(off + 11),
      totalAlighted: value.readUInt32LE(off + 15),
    });
  }
  const total = value.length - PEOPLE_TOTAL_BYTES;
  return {
    version: value.readUInt8(0),
    sensors,
    boarded: value.readUInt32LE(total),
    alighted: value.readUInt32LE(total + 4),
    totalBoarded: value.readUInt32LE(total + 8),
    totalAlighted: value.readUInt32LE(total + 12),
    onBoard: value.readUInt32LE(total + 16),
  };
}

function scale(raw: number | null, divisor: number, digits: number): number | null {
  if (raw === null) return null;
  const factor = 10 ** digits;
  return Math.round((raw / divisor) * factor) / factor;
}

function u8(value: Buffer | undefined): number | null {
  return value && value.length >= 1 ? value.readUInt8(0) : null;
}

function u16(value: Buffer | undefined): number | null {
  if (!value || value.length < 1) return null;
  return value.length >= 2 ? value.readUInt16LE(0) : value.readUInt8(0);
}

function s16(value: Buffer | undefined): number | null {
  return value && value.length >= 2 ? value.readInt16LE(0) : null;
}

function u32(value: Buffer | undefined): number | null {
  return value && value.length >= 4 ? value.readUInt32LE(0) : null;
}

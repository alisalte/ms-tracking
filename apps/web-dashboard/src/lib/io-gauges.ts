/**
 * Turn a Teltonika I/O panel into gauge models for the device popup.
 *
 * The device sends analog inputs as volts only. Which sensor is wired to an
 * input (fuel sender, coolant temperature sender…) is set per vehicle
 * (`IoSensorConfig`); its calibration points map volts to fuel % or °C,
 * piecewise linear and clamped to the calibrated range. Inputs without a
 * sensor stay voltmeters. Sensors the device already reports in real units
 * (CAN fuel %, CAN engine temperature, 1-Wire probes, RPM, speed) are drawn
 * as gauges directly.
 */
import type {
  FmbIoGroup,
  FmbIoPanel,
  FmbIoPoint,
  IoCalibrationPoint,
  IoSensorConfig,
  IoSensorInput,
} from '@/types/fleet.types';

/** Severity drawn next to a gauge (always with a text label, never colour alone). */
export type GaugeLevel = 'normal' | 'cold' | 'warning' | 'critical';

interface GaugeBase {
  /** Stable React key. */
  readonly id: string;
  /** i18n key of the title (`map.io.points.*`), or a custom label. */
  readonly titleKey: string | null;
  readonly label?: string;
  /** Technical code shown small under the title (AIN1, AVL 115…). */
  readonly code: string;
  readonly at: string;
}

export interface FuelGauge extends GaugeBase {
  readonly type: 'fuel';
  /** 0–100. */
  readonly percent: number;
  readonly liters: number | null;
  /** Raw input voltage when the value came from an analog input. */
  readonly volts: number | null;
  readonly level: GaugeLevel;
}

export interface TempGauge extends GaugeBase {
  readonly type: 'temp';
  readonly celsius: number;
  /** Scale of the thermometer column. */
  readonly min: number;
  readonly max: number;
  readonly volts: number | null;
  readonly level: GaugeLevel;
  /**
   * `engine`: coolant sender, coloured by its warning level.
   * `ambient`: fridge / cargo / air probe, coloured by the temperature itself.
   */
  readonly scale: 'engine' | 'ambient';
}

export interface DialGauge extends GaugeBase {
  readonly type: 'dial';
  readonly value: number;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
}

export interface SwitchGauge extends GaugeBase {
  readonly type: 'switch';
  readonly on: boolean;
  readonly output: boolean;
}

export interface ValueGauge extends GaugeBase {
  readonly type: 'value';
  readonly text: string;
  readonly unit?: string;
  readonly icon: 'fuel' | 'key' | 'odometer' | 'generic';
}

export type Gauge = FuelGauge | TempGauge | DialGauge | SwitchGauge | ValueGauge;

/** Fuel thresholds (% of tank). */
export const FUEL_LOW = 25;
export const FUEL_CRITICAL = 12;
/** Engine coolant thresholds (°C). */
export const ENGINE_COLD = 40;
export const ENGINE_WARM = 100;
export const ENGINE_HOT = 108;

/**
 * Volts → value through calibration points (piecewise linear). Outside the
 * calibrated range the end value is held: a sender is not extrapolated.
 * Returns null without at least two points.
 */
export function calibrate(points: readonly IoCalibrationPoint[], volts: number): number | null {
  const pts = [...points].filter((p) => Number.isFinite(p.v) && Number.isFinite(p.value));
  pts.sort((a, b) => a.v - b.v);
  if (pts.length < 2 || !Number.isFinite(volts)) return null;
  const first = pts[0] as IoCalibrationPoint;
  const last = pts[pts.length - 1] as IoCalibrationPoint;
  if (volts <= first.v) return first.value;
  if (volts >= last.v) return last.value;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as IoCalibrationPoint;
    const b = pts[i] as IoCalibrationPoint;
    if (volts <= b.v) {
      const t = (volts - a.v) / (b.v - a.v);
      return a.value + t * (b.value - a.value);
    }
  }
  return last.value;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function fuelLevel(percent: number): GaugeLevel {
  if (percent <= FUEL_CRITICAL) return 'critical';
  if (percent <= FUEL_LOW) return 'warning';
  return 'normal';
}

export function engineTempLevel(celsius: number): GaugeLevel {
  if (celsius >= ENGINE_HOT) return 'critical';
  if (celsius >= ENGINE_WARM) return 'warning';
  if (celsius < ENGINE_COLD) return 'cold';
  return 'normal';
}

function codeOf(p: FmbIoPoint): string {
  if (p.key && (p.group === 'din' || p.group === 'dout' || p.group === 'ain')) {
    return p.key.toUpperCase();
  }
  return `AVL ${p.id}`;
}

function base(p: FmbIoPoint): GaugeBase {
  return { id: `${p.group}-${p.id}`, titleKey: p.key, code: codeOf(p), at: p.at };
}

function num(p: FmbIoPoint): number | null {
  return typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null;
}

/** Scale that fits a value with headroom: the first of `steps` above it. */
function niceMax(value: number, steps: readonly number[]): number {
  return steps.find((s) => value <= s) ?? Math.ceil(value / 1000) * 1000;
}

function fuelGauge(
  p: FmbIoPoint,
  percent: number,
  tankLiters: number | undefined,
  volts: number | null,
  label?: string,
): FuelGauge {
  const pct = clamp(round1(percent), 0, 100);
  return {
    ...base(p),
    ...(label ? { label } : {}),
    type: 'fuel',
    percent: pct,
    liters: tankLiters ? Math.round((pct / 100) * tankLiters) : null,
    volts,
    level: fuelLevel(pct),
  };
}

function engineGauge(p: FmbIoPoint, celsius: number, volts: number | null, label?: string) {
  const c = round1(celsius);
  return {
    ...base(p),
    ...(label ? { label } : {}),
    type: 'temp',
    celsius: c,
    min: 0,
    max: Math.max(130, Math.ceil(c / 10) * 10),
    volts,
    level: engineTempLevel(c),
    scale: 'engine',
  } satisfies TempGauge;
}

function ambientGauge(p: FmbIoPoint, celsius: number): TempGauge {
  const c = round1(celsius);
  return {
    ...base(p),
    type: 'temp',
    celsius: c,
    min: Math.min(-30, Math.floor(c / 10) * 10),
    max: Math.max(60, Math.ceil(c / 10) * 10),
    volts: null,
    level: 'normal',
    scale: 'ambient',
  };
}

/** Thermometer scaled to a calibrated range, without engine thresholds. */
function rangeGauge(
  p: FmbIoPoint,
  celsius: number,
  low: number,
  high: number,
  volts: number,
  label?: string,
): TempGauge {
  const c = round1(celsius);
  return {
    ...base(p),
    ...(label ? { label } : {}),
    type: 'temp',
    celsius: c,
    min: Math.floor(Math.min(low, c) / 10) * 10,
    max: Math.ceil(Math.max(high, c) / 10) * 10,
    volts,
    level: 'normal',
    scale: 'ambient',
  };
}

function analogGauge(p: FmbIoPoint, sensor: IoSensorConfig | undefined): Gauge | null {
  const volts = num(p);
  if (volts === null) return null;
  if (sensor?.kind === 'fuel') {
    const pct = calibrate(sensor.points, volts);
    if (pct !== null) {
      return {
        ...fuelGauge(p, pct, sensor.tankLiters, volts, sensor.label),
        titleKey: 'sensorFuel',
      };
    }
  }
  if (sensor?.kind === 'temperature') {
    const c = calibrate(sensor.points, volts);
    if (c !== null) {
      // Only a sender calibrated into the engine's working range is a coolant
      // sensor; a fridge / cargo / ambient probe (e.g. -3…62 °C) must not get
      // "cold engine" warnings or a 0–130 °C scale.
      const values = sensor.points.map((pt) => pt.value);
      const top = Math.max(...values);
      const gauge =
        top >= ENGINE_WARM
          ? engineGauge(p, c, volts, sensor.label)
          : rangeGauge(p, c, Math.min(...values), top, volts, sensor.label);
      return { ...gauge, titleKey: 'sensorTemp' };
    }
  }
  return {
    ...base(p),
    ...(sensor?.label ? { label: sensor.label } : {}),
    type: 'dial',
    value: volts,
    unit: 'V',
    min: 0,
    max: niceMax(volts, [5, 10, 15, 30]),
  };
}

function canGauge(p: FmbIoPoint): Gauge | null {
  const n = num(p);
  if (n === null) return null;
  switch (p.key) {
    case 'canFuelLevelPct':
      return fuelGauge(p, n, undefined, null);
    case 'canEngineTemp':
      return engineGauge(p, n, null);
    case 'canRpm':
      return {
        ...base(p),
        type: 'dial',
        value: n,
        unit: 'rpm',
        min: 0,
        max: niceMax(n, [3000, 5000, 8000]),
      };
    case 'canSpeed':
      return {
        ...base(p),
        type: 'dial',
        value: n,
        unit: 'km/h',
        min: 0,
        max: niceMax(n, [140, 200]),
      };
    case 'canPedal':
      return { ...base(p), type: 'dial', value: n, unit: '%', min: 0, max: 100 };
    case 'canFuelLevelL':
    case 'canFuelUsed':
      return { ...base(p), type: 'value', text: String(n), unit: p.unit, icon: 'fuel' };
    case 'canMileage':
      return {
        ...base(p),
        type: 'value',
        text: Math.round(n).toLocaleString('en-US'),
        unit: p.unit,
        icon: 'odometer',
      };
    default:
      return { ...base(p), type: 'value', text: String(n), unit: p.unit, icon: 'generic' };
  }
}

function pointGauge(p: FmbIoPoint, sensors: ReadonlyMap<string, IoSensorConfig>): Gauge | null {
  switch (p.group) {
    case 'din':
    case 'dout':
      return typeof p.value === 'boolean'
        ? { ...base(p), type: 'switch', on: p.value, output: p.group === 'dout' }
        : null;
    case 'ain':
      return analogGauge(p, p.key ? sensors.get(p.key) : undefined);
    case 'onewire': {
      if (p.key === 'ibutton') {
        return { ...base(p), type: 'value', text: String(p.value || '—'), icon: 'key' };
      }
      const n = num(p);
      return n === null ? null : ambientGauge(p, n);
    }
    case 'serial': {
      const n = num(p);
      if (n === null) return null;
      if (p.key === 'lls1Temp' || p.key === 'lls2Temp') return ambientGauge(p, n);
      return { ...base(p), type: 'value', text: String(n), unit: p.unit, icon: 'fuel' };
    }
    case 'can':
      return canGauge(p);
    default:
      return null;
  }
}

/** Sections of the graphic view, in display order. */
export type GaugeSection = 'fuel' | 'temp' | 'dial' | 'switch' | 'value';

export interface GaugeView {
  readonly sections: ReadonlyArray<{ section: GaugeSection; gauges: readonly Gauge[] }>;
  /** Points not drawn as a gauge (unnamed / J1708 / K-Line) — still in the list view. */
  readonly hidden: number;
}

const SECTION_ORDER: readonly GaugeSection[] = ['fuel', 'temp', 'dial', 'switch', 'value'];
const GROUPS: readonly FmbIoGroup[] = ['ain', 'can', 'serial', 'onewire', 'din', 'dout'];

/** Build the graphic view of a panel with the vehicle's sensor wiring applied. */
export function buildGaugeView(
  panel: FmbIoPanel,
  sensors: readonly IoSensorConfig[] = [],
): GaugeView {
  const byInput = new Map<IoSensorInput | string, IoSensorConfig>(sensors.map((s) => [s.input, s]));
  const buckets = new Map<GaugeSection, Gauge[]>();
  let total = 0;
  let drawn = 0;
  for (const g of Object.keys(panel.groups) as FmbIoGroup[]) total += panel.groups[g]?.length ?? 0;
  for (const group of GROUPS) {
    for (const p of panel.groups[group] ?? []) {
      const gauge = pointGauge(p, byInput);
      if (!gauge) continue;
      drawn++;
      const section: GaugeSection = gauge.type;
      const list = buckets.get(section) ?? [];
      list.push(gauge);
      buckets.set(section, list);
    }
  }
  return {
    sections: SECTION_ORDER.filter((s) => buckets.has(s)).map((section) => ({
      section,
      gauges: buckets.get(section) ?? [],
    })),
    hidden: total - drawn,
  };
}

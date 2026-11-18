/**
 * Analog-input and fuel-level readings to keep with a stored position.
 *
 * The FMB I/O panel is a live snapshot (Redis + websocket), so only the few
 * readings the reports need are copied onto the position metadata:
 *
 *   - `analog`: raw volts of AIN1–AIN4. Which sensor is wired to an input and
 *     how volts map to °C or fuel % is vehicle configuration (`io_sensors` on
 *     `fleet.vehicles`), so the conversion happens on the read path.
 *   - `fuel`: LLS level and CAN fuel level (litres / percent).
 *
 * The panel is merged across records, so a point can be older than the fix. A
 * reading is kept only while it is plausibly the fix's reading: analog inputs
 * change continuously (2 minutes), while a fuel level may legitimately stay
 * unchanged for a while, so it gets a wider window.
 */
import type { FmbIoPanel } from '../infrastructure/cache/fmb-io-memory.js';
import { PROBE_FRESH_MS } from './probe-temperatures.js';

/** Analog inputs the dashboard can map to a fuel or temperature sender. */
const ANALOG_KEYS: ReadonlySet<string> = new Set(['ain1', 'ain2', 'ain3', 'ain4']);

/** Fuel-level sensors: LLS (RS232/485) and CAN. */
const FUEL_KEYS: ReadonlySet<string> = new Set([
  'lls1Level',
  'lls2Level',
  'canFuelLevelL',
  'canFuelLevelPct',
]);

/** An unchanged fuel level is still current for this long (merged panel). */
export const FUEL_FRESH_MS = 15 * 60_000;

export interface IoReadings {
  /** Analog input volts, e.g. `{ ain1: 2.424 }`. */
  readonly analog?: Readonly<Record<string, number>>;
  /** Fuel levels, e.g. `{ canFuelLevelPct: 47, canFuelLevelL: 141.2 }`. */
  readonly fuel?: Readonly<Record<string, number>>;
}

export function ioReadings(
  panel: FmbIoPanel | null | undefined,
  capturedAt: Date,
): IoReadings | null {
  if (!panel || typeof panel !== 'object' || !panel.groups) return null;
  const fix = capturedAt.getTime();
  const analog: Record<string, number> = {};
  const fuel: Record<string, number> = {};
  for (const points of Object.values(panel.groups)) {
    for (const p of points ?? []) {
      if (!p.key) continue;
      const analogKey = ANALOG_KEYS.has(p.key);
      if (!analogKey && !FUEL_KEYS.has(p.key)) continue;
      if (typeof p.value !== 'number' || !Number.isFinite(p.value)) continue;
      const at = Date.parse(p.at);
      if (
        !Number.isFinite(at) ||
        Math.abs(at - fix) > (analogKey ? PROBE_FRESH_MS : FUEL_FRESH_MS)
      ) {
        continue;
      }
      (analogKey ? analog : fuel)[p.key] = Math.round(p.value * 1000) / 1000;
    }
  }
  if (Object.keys(analog).length === 0 && Object.keys(fuel).length === 0) return null;
  return {
    ...(Object.keys(analog).length > 0 ? { analog } : {}),
    ...(Object.keys(fuel).length > 0 ? { fuel } : {}),
  };
}

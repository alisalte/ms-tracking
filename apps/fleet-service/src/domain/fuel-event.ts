/**
 * Fuel Analytics v1 — event kinds, device-code mapping, summary helpers.
 */

export const FUEL_EVENT_KINDS = ['refill', 'drop', 'level', 'manual'] as const;
export type FuelEventKind = (typeof FUEL_EVENT_KINDS)[number];

export const FUEL_EVENT_SOURCES = ['device', 'manual'] as const;
export type FuelEventSource = (typeof FUEL_EVENT_SOURCES)[number];

export const FUEL_DEVICE_CODES = ['FUEL_THEFT', 'FUEL_LOW', 'FUEL_FULL', 'FUEL_FILLING'] as const;
export type FuelDeviceCode = (typeof FUEL_DEVICE_CODES)[number];

export function isFuelDeviceCode(code: string): code is FuelDeviceCode {
  return (FUEL_DEVICE_CODES as readonly string[]).includes(code);
}

/** Map Meitrack / alarm device code → fuel event kind. */
export function mapFuelDeviceCodeToKind(code: string): FuelEventKind | null {
  const c = code.toUpperCase();
  if (c === 'FUEL_FILLING' || c === 'FUEL_FULL') return 'refill';
  if (c === 'FUEL_THEFT' || c === 'FUEL_LOW') return 'drop';
  return null;
}

export function isFuelTheftAnomaly(kind: FuelEventKind, deviceCode: string | null): boolean {
  return kind === 'drop' && (deviceCode === 'FUEL_THEFT' || deviceCode === null);
}

/** Liters that count toward "filled" in L/100km (manual + refill with volume). */
export function litersInForSummary(
  events: ReadonlyArray<{ kind: FuelEventKind; volumeLiters: number | null }>,
): number {
  let sum = 0;
  for (const e of events) {
    if (e.volumeLiters == null || !(e.volumeLiters > 0)) continue;
    if (e.kind === 'manual' || e.kind === 'refill') sum += e.volumeLiters;
  }
  return sum;
}

export function litersDroppedForSummary(
  events: ReadonlyArray<{ kind: FuelEventKind; volumeLiters: number | null }>,
): number {
  let sum = 0;
  for (const e of events) {
    if (e.kind !== 'drop') continue;
    if (e.volumeLiters == null || !(e.volumeLiters > 0)) continue;
    sum += e.volumeLiters;
  }
  return sum;
}

/** Recorded liters per 100 km (null when distance or liters missing). */
export function litersPer100Km(litersIn: number, distanceKm: number): number | null {
  if (!(litersIn > 0) || !(distanceKm > 0)) return null;
  return (litersIn / distanceKm) * 100;
}

export const DEFAULT_FUEL_PERIOD_DAYS = 30;

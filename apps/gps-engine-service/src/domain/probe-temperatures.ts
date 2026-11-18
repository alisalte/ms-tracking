/**
 * Cargo / fridge probe temperatures to keep with a stored position.
 *
 * The FMB I/O panel is a live snapshot (Redis + websocket) and is not stored
 * with positions. The temperature report needs the probe history, so the few
 * probe readings are copied onto the position's metadata as `temps`
 * (`{ temp1: 4.5, lls1Temp: 21 }`, °C).
 *
 * The panel is merged across records, so a point can be older than the fix; a
 * reading is kept only when the device reported it close to the fix's time —
 * a disconnected probe must not repeat its last value forever.
 */
import type { FmbIoPanel } from '../infrastructure/cache/fmb-io-memory.js';

/** Probe points: 1-Wire Dallas probes and the LLS fuel sensors' own thermometers. */
const PROBE_KEYS: ReadonlySet<string> = new Set([
  'temp1',
  'temp2',
  'temp3',
  'temp4',
  'lls1Temp',
  'lls2Temp',
]);

/** A point reported further than this from the fix is not this fix's reading. */
export const PROBE_FRESH_MS = 120_000;

export function probeTemperatures(
  panel: FmbIoPanel | null | undefined,
  capturedAt: Date,
): Record<string, number> | null {
  if (!panel || typeof panel !== 'object' || !panel.groups) return null;
  const out: Record<string, number> = {};
  const fix = capturedAt.getTime();
  for (const group of ['onewire', 'serial'] as const) {
    for (const p of panel.groups[group] ?? []) {
      if (!p.key || !PROBE_KEYS.has(p.key)) continue;
      if (typeof p.value !== 'number' || !Number.isFinite(p.value)) continue;
      const at = Date.parse(p.at);
      if (!Number.isFinite(at) || Math.abs(at - fix) > PROBE_FRESH_MS) continue;
      out[p.key] = Math.round(p.value * 100) / 100;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

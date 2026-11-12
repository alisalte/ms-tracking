/**
 * FMB640 I/O panel — the physical inputs/outputs and bus sensors of one device,
 * grouped for the live "I/O" view in the dashboard.
 *
 * A Teltonika record usually carries only the IO elements that changed (plus a
 * periodic full set), so one record is never the whole picture. This module
 * only builds the points of ONE record; `FmbIoStore` merges them with what the
 * device reported before, and the merged panel rides the envelope as
 * `telemetry.fmbIo`.
 *
 * AVL ids below follow Teltonika's FMB6xx parameter list. The ids of RS232 /
 * RS485 sensors, J1708 and K-Line depend on how the unit is configured, so:
 *   - serial sensors: only the LLS fuel-level ids are mapped;
 *   - J1708 / K-Line: no fixed ids exist — extend `IO_POINTS` once the unit's
 *     configurator mapping is known;
 *   - any other IO element is kept in the `other` group with its raw id, so
 *     nothing the device sends is invisible.
 * Verify the table against the device's Data Sending Parameters page before
 * rollout: ids that are model-specific (AIN4, DOUT3/4) are the likeliest to differ.
 */
import type { FmbIoGroup, FmbIoPanel, FmbIoPoint } from '../../../domain/fmb-io-panel.js';

interface PointDef {
  /** i18n key suffix shown by the dashboard (`map.io.points.<key>`). */
  readonly key: string;
  readonly group: FmbIoGroup;
  readonly scale?: number;
  readonly signed?: boolean;
  readonly bool?: boolean;
  readonly unit?: string;
}

export const IO_POINTS: Readonly<Record<number, PointDef>> = {
  // Digital inputs (switch, door, PTO …)
  1: { key: 'din1', group: 'din', bool: true },
  2: { key: 'din2', group: 'din', bool: true },
  3: { key: 'din3', group: 'din', bool: true },
  4: { key: 'din4', group: 'din', bool: true },
  // Digital outputs (relay, immobiliser …) — state only; control is a command.
  179: { key: 'dout1', group: 'dout', bool: true },
  180: { key: 'dout2', group: 'dout', bool: true },
  380: { key: 'dout3', group: 'dout', bool: true },
  381: { key: 'dout4', group: 'dout', bool: true },
  // Analog inputs, mV → V
  9: { key: 'ain1', group: 'ain', scale: 0.001, unit: 'V' },
  10: { key: 'ain2', group: 'ain', scale: 0.001, unit: 'V' },
  11: { key: 'ain3', group: 'ain', scale: 0.001, unit: 'V' },
  19: { key: 'ain4', group: 'ain', scale: 0.001, unit: 'V' },
  // FMB64x send Analog Input 4 as AVL 245; without it AIN4 landed in "Other".
  245: { key: 'ain4', group: 'ain', scale: 0.001, unit: 'V' },
  // 1-Wire: Dallas temperature probes (0.1 °C) and iButton
  72: { key: 'temp1', group: 'onewire', scale: 0.1, signed: true, unit: '°C' },
  73: { key: 'temp2', group: 'onewire', scale: 0.1, signed: true, unit: '°C' },
  74: { key: 'temp3', group: 'onewire', scale: 0.1, signed: true, unit: '°C' },
  75: { key: 'temp4', group: 'onewire', scale: 0.1, signed: true, unit: '°C' },
  78: { key: 'ibutton', group: 'onewire' },
  // RS232 / RS485: LLS fuel-level sensors
  201: { key: 'lls1Level', group: 'serial', signed: true },
  202: { key: 'lls1Temp', group: 'serial', signed: true, unit: '°C' },
  203: { key: 'lls2Level', group: 'serial', signed: true },
  204: { key: 'lls2Temp', group: 'serial', signed: true, unit: '°C' },
  // CAN J1939 / FMS
  81: { key: 'canSpeed', group: 'can', unit: 'km/h' },
  82: { key: 'canPedal', group: 'can', unit: '%' },
  83: { key: 'canFuelUsed', group: 'can', scale: 0.1, unit: 'L' },
  84: { key: 'canFuelLevelL', group: 'can', scale: 0.1, unit: 'L' },
  85: { key: 'canRpm', group: 'can', unit: 'rpm' },
  87: { key: 'canMileage', group: 'can', scale: 0.001, unit: 'km' },
  89: { key: 'canFuelLevelPct', group: 'can', unit: '%' },
  115: { key: 'canEngineTemp', group: 'can', scale: 0.1, signed: true, unit: '°C' },
};

/**
 * IO ids the platform already shows elsewhere (GPS, power, ignition, odometer…).
 * They are not repeated under `other`.
 */
const SHOWN_ELSEWHERE: ReadonlySet<number> = new Set([
  16, 17, 18, 21, 66, 67, 68, 69, 113, 181, 182, 199, 200, 239, 240, 241,
]);

/** An IO element as decoded: unsigned value plus its wire width in bytes. */
export interface DecodedIo {
  readonly value: number | bigint | Buffer;
  readonly width: number;
}

function toSigned(n: number, widthBytes: number): number {
  const bits = widthBytes * 8;
  return n >= 2 ** (bits - 1) ? n - 2 ** bits : n;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Points of one record: every catalogued element, plus unmapped ones under `other`. */
export function buildFmbIoPoints(
  io: ReadonlyMap<number, DecodedIo>,
  at: Date,
): readonly FmbIoPoint[] {
  const iso = at.toISOString();
  const out: FmbIoPoint[] = [];
  for (const [id, entry] of io) {
    const def = IO_POINTS[id];
    if (!def) {
      if (SHOWN_ELSEWHERE.has(id)) continue;
      const v = entry.value;
      out.push({
        id,
        key: null,
        group: 'other',
        value: Buffer.isBuffer(v) ? v.toString('hex') : Number(v),
        at: iso,
      });
      continue;
    }
    const v = entry.value;
    if (Buffer.isBuffer(v)) {
      out.push({ id, key: def.key, group: def.group, value: v.toString('hex'), at: iso });
      continue;
    }
    const n = Number(v);
    const value: number | boolean | string = def.bool
      ? n !== 0
      : (() => {
          // iButton / 8-byte ids are identifiers, not quantities.
          if (def.key === 'ibutton') return n === 0 ? '' : BigInt(v).toString(16).toUpperCase();
          const base = def.signed ? toSigned(n, entry.width) : n;
          return def.scale ? round(base * def.scale) : base;
        })();
    out.push({
      id,
      key: def.key,
      group: def.group,
      value,
      ...(def.unit ? { unit: def.unit } : {}),
      at: iso,
    });
  }
  return out;
}

/** Group a flat list of (merged) points into the panel shape. */
export function toFmbIoPanel(points: readonly FmbIoPoint[], updatedAt: Date): FmbIoPanel {
  const groups: Partial<Record<FmbIoGroup, FmbIoPoint[]>> = {};
  for (const p of [...points].sort((a, b) => a.id - b.id)) {
    const list = groups[p.group] ?? [];
    list.push(p);
    groups[p.group] = list;
  }
  return { updatedAt: updatedAt.toISOString(), groups };
}

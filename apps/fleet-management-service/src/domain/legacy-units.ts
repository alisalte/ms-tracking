/**
 * Legacy tracking-system unit rows — pure helpers for the migration import.
 *
 * Two legacy exports describe the same thing (one tracker on one vehicle):
 *   - the "objects" CSV  (نام, IMEI, پلاک, گروه, مدل, VIN, شماره سیم کارت, فعال, …, مسافت سنج, …)
 *   - the Wialon "Units" sheet (Name, Device type, UID, Phone, Groups, Custom fields)
 * The dashboard maps either one to `LegacyUnitRow`; the server only sees that.
 */
import type { Protocol } from './device/device-types.js';

/** Registry code of a vehicle created by the legacy import: stable per tracker. */
export function legacyVehicleCode(imei: string): string {
  return `L${imei}`;
}

/** Vehicle code the auto-enroll path gives a tracker's placeholder vehicle. */
export function autoVehicleCode(imei: string): string {
  return `D${imei}`;
}

/**
 * Wire protocol of a legacy device model, e.g. `FMB120`, `Teltonika FM1120`,
 * `MT90`, `T366G`. Null when the model does not say.
 */
export function protocolForModel(model: string | null | undefined): Protocol | null {
  if (!model) return null;
  const m = model.trim().replace(/\s+/g, ' ');
  if (/teltonika/i.test(m)) return 'teltonika';
  // Bare Teltonika model numbers some exports keep: `1120`, `1110`, `4200`.
  if (/^(1[01]\d\d|4[12]00)$/.test(m)) return 'teltonika';
  if (/^(FM[A-Z]?\d|FMB|FMC|FMM|FMP|FMT|FMU|FMA|TFT|TAT|TMT|MTB|GH\d)/i.test(m)) return 'teltonika';
  if (/meitrack|^MT\d|^T3\d\d|^T6\d\d|^P99|^TC68|^MD\d/i.test(m)) return 'meitrack';
  if (/gt06|concox|^GT\d|^JM-?VL|^JM\d/i.test(m)) return 'gt06';
  if (/jt-?808|jt-?1078/i.test(m)) return 'jt808';
  return null;
}

/** Manufacturer named by a legacy model, when it says. */
export function manufacturerForProtocol(protocol: Protocol): string | null {
  switch (protocol) {
    case 'teltonika':
      return 'Teltonika';
    case 'meitrack':
      return 'Meitrack';
    case 'gt06':
      return 'Concox';
    default:
      return null;
  }
}

/** Model without a leading manufacturer word: `Teltonika FM1120` → `FM1120`. */
export function bareModel(model: string | null | undefined): string | null {
  if (!model) return null;
  const m = model.trim().replace(/^(teltonika|meitrack|concox)\s+/i, '');
  return m === '' ? null : m;
}

/** First phone of a legacy "Phone" cell (`+98901…, +3528…`), digits and a leading +. */
export function primarySim(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const part of raw.split(/[,;\s]+/)) {
    const p = part.trim().replace(/[^\d+]/g, '');
    if (/^\+?\d{8,15}$/.test(p)) return p;
  }
  return null;
}

/**
 * Temperature correction of a vehicle from its legacy custom fields: the
 * "شیفت دما" (temperature shift) field, e.g. `+3`, `-7`, `2.5`. Null when absent.
 */
export function temperatureShift(
  fields: Readonly<Record<string, string>> | null | undefined,
): number | null {
  if (!fields) return null;
  for (const [key, value] of Object.entries(fields)) {
    const k = key.replace(/[‌\s]+/g, '');
    if (k === 'شیفتدما' || /^temp(erature)?shift$/i.test(k)) {
      const n = Number(String(value).replace(/[^\d.+-]/g, ''));
      if (Number.isFinite(n) && Math.abs(n) <= 50) return n;
    }
  }
  return null;
}

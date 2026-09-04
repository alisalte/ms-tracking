/**
 * Parse a Meitrack command ACK into catalog param values so the wizard /
 * command form can show what is already set on the device.
 *
 * A11/A21 (and similar) only reply `OK` on GPRS. Current values come from
 * DB4 (§3.168) or DA6 (§3.165) dumps, or from the last SET params we stored.
 */

export const SETTINGS_DUMP_CODES = ['DB4', 'DA6'] as const;

export function parseMeitrackReadback(
  code: string,
  responseText: string | null | undefined,
): Record<string, string> | null {
  if (!responseText) return null;
  const raw = responseText.trim();
  if (!raw) return null;

  const dump = parseSettingsDump(raw);
  if (dump) {
    const fromDump = fieldsForCode(code, dump);
    if (fromDump && Object.keys(fromDump).length > 0) return fromDump;
  }

  const parts = raw.split(',');
  const body = parts[0]?.toUpperCase() === code.toUpperCase() ? parts.slice(1) : parts;
  if (body.length === 0) return null;
  if (body.length === 1 && /^ok$/i.test(body[0] ?? '')) return {};

  switch (code) {
    case 'A11':
      return body[0] ? { minutes: body[0] } : null;
    case 'A12':
    case 'A15':
      return body[0] ? { interval: body[0] } : null;
    case 'A13':
      return body[0] ? { angle: body[0] } : null;
    case 'A14':
      return body[0] ? { distance: body[0] } : null;
    case 'A16':
      return body[0] ? { status: body[0] } : null;
    case 'A17':
      return body[0] ? { enabled: body[0] } : null;
    case 'A21':
    case 'A25':
      return {
        mode: body[0] ?? '',
        host: body[1] ?? '',
        port: body[2] ?? '',
        apn: body[3] ?? '',
        apnUser: body[4] ?? '',
        apnPassword: body[5] ?? '',
      };
    case 'A23':
      return { host: body[0] ?? '', port: body[1] ?? '' };
    case 'ABB':
      return { enabled: body[0] ?? '', ssid: body[1] ?? '', password: body[2] ?? '' };
    default:
      return null;
  }
}

export interface CommandHistoryLike {
  readonly commandCode: string;
  readonly status: string;
  readonly params: Record<string, unknown> | null;
  readonly responseText: string | null;
}

/** Latest device-truth (DB4/DA6) or last SET params for one catalog command. */
export function lastStoredSettings(
  code: string,
  history: readonly CommandHistoryLike[],
): Record<string, string> | null {
  for (const rec of history) {
    if (rec.status !== 'ACKED') continue;
    if (!(SETTINGS_DUMP_CODES as readonly string[]).includes(rec.commandCode)) continue;
    const parsed = parseMeitrackReadback(code, rec.responseText);
    if (parsed && Object.keys(parsed).length > 0) return parsed;
  }
  for (const rec of history) {
    if (rec.commandCode !== code || rec.status !== 'ACKED') continue;
    const parsed = parseMeitrackReadback(code, rec.responseText);
    if (parsed && Object.keys(parsed).length > 0) return parsed;
    const fromParams = stringifyParams(rec.params);
    if (fromParams) return fromParams;
  }
  return null;
}

interface SettingsDump {
  readonly mode: string;
  readonly host: string;
  readonly port: string;
  readonly backupHost: string;
  readonly backupPort: string;
  readonly apn: string;
  readonly heartbeat: string;
  readonly interval: string;
  readonly parkingInterval: string;
  readonly distance: string;
  readonly overspeed: string;
  readonly angle: string;
}

function parseSettingsDump(raw: string): SettingsDump | null {
  const upper = raw.toUpperCase();
  if (!upper.startsWith('DB4') && !upper.startsWith('DA6') && !upper.includes('IP1:')) {
    return null;
  }
  const labeled = new Map<string, string>();
  const positional: string[] = [];
  for (const part of raw.split(',')) {
    const idx = part.indexOf(':');
    if (idx > 0 && !/^\d+$/.test(part.slice(0, idx))) {
      labeled.set(part.slice(0, idx).trim().toUpperCase(), part.slice(idx + 1).trim());
    } else {
      positional.push(part.trim());
    }
  }
  const afterCode =
    positional[0]?.toUpperCase() === 'DB4' || positional[0]?.toUpperCase() === 'DA6'
      ? positional.slice(1)
      : positional;

  const modeRaw = labeled.get('CONNECT') ?? afterCode[0] ?? '';
  return {
    mode: gprsMode(modeRaw),
    host: labeled.get('IP1') ?? '',
    port: labeled.get('PORT1') ?? '',
    backupHost: labeled.get('IP2') ?? '',
    backupPort: labeled.get('PORT2') ?? '',
    apn: labeled.get('APN') ?? afterCode[2] ?? '',
    heartbeat: labeled.get('HEARTBEAT') ?? afterCode[4] ?? '',
    interval: labeled.get('GPRS_INT') ?? afterCode[6] ?? '',
    parkingInterval: afterCode[7] ?? '',
    distance: afterCode[8] ?? '',
    overspeed: afterCode[9] ?? '',
    angle: afterCode[10] ?? '',
  };
}

function fieldsForCode(code: string, dump: SettingsDump): Record<string, string> | null {
  switch (code) {
    case 'A11':
      return dump.heartbeat ? { minutes: dump.heartbeat } : null;
    case 'A12':
      return dump.interval ? { interval: dump.interval } : null;
    case 'A13':
      return dump.angle ? { angle: dump.angle } : null;
    case 'A14':
      return dump.distance ? { distance: dump.distance } : null;
    case 'A15':
      return dump.parkingInterval ? { interval: dump.parkingInterval } : null;
    case 'A21':
      return {
        mode: dump.mode,
        host: dump.host,
        port: dump.port,
        apn: dump.apn,
        apnUser: '',
        apnPassword: '',
      };
    case 'A23':
      return { host: dump.backupHost, port: dump.backupPort };
    case 'A25':
      return {
        mode: dump.mode,
        host: dump.host,
        port: dump.port,
        apn: dump.apn,
        apnUser: '',
        apnPassword: '',
      };
    default:
      return null;
  }
}

function gprsMode(raw: string): string {
  const u = raw.toUpperCase();
  if (u === '1' || u.includes('TCP')) return '1';
  if (u === '2' || u.includes('UDP')) return '2';
  if (u === '0' || u.includes('CLOSE') || u.includes('DISABLE')) return '0';
  return raw;
}

function stringifyParams(params: Record<string, unknown> | null): Record<string, string> | null {
  if (!params) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = String(value);
  }
  return Object.keys(out).length > 0 ? out : null;
}

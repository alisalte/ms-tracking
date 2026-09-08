/**
 * Device Parameter → Alarm (vendor-app Link Sett parity).
 *
 * Composes Meitrack catalog commands from a product-facing Link Sett form.
 * Device remains source of truth; localStorage snapshots cache last set /
 * readback for Refresh when protocol coverage is incomplete.
 */

import {
  type ParameterSnapshot,
  type ParameterSnapshotSource,
  loadParameterSnapshot,
  parameterCacheKey,
  saveParameterSnapshot,
  stampParameterSnapshot,
} from '@/lib/device-parameter-state';

export interface AlarmParameterEventDef {
  /** Meitrack event code (AAA `event` field). */
  code: number;
  /** i18n key under `commands.parameter.events.*` */
  labelKey: string;
  /** Default Alarm head (B91). */
  defaultAlarmHead: string;
}

/** Phase 1 screenshot events + MDVR §1.3 digital inputs (2–8 active, 1–8 inactive). */
export const ALARM_PARAMETER_EVENTS: readonly AlarmParameterEventDef[] = [
  { code: 1, labelKey: 'sos', defaultAlarmHead: 'SOS' },
  // MDVR protocol: codes 2–8 = Input 2–8 Active (no Input 1 Active; code 1 is SOS).
  { code: 2, labelKey: 'input2Active', defaultAlarmHead: 'In2 Active' },
  { code: 3, labelKey: 'input3Active', defaultAlarmHead: 'In3 Active' },
  { code: 4, labelKey: 'input4Active', defaultAlarmHead: 'In4 Active' },
  { code: 5, labelKey: 'input5Active', defaultAlarmHead: 'In5 Active' },
  { code: 6, labelKey: 'input6Active', defaultAlarmHead: 'In6 Active' },
  { code: 7, labelKey: 'input7Active', defaultAlarmHead: 'In7 Active' },
  { code: 8, labelKey: 'input8Active', defaultAlarmHead: 'In8 Active' },
  { code: 9, labelKey: 'input1Inactive', defaultAlarmHead: 'In1 Inactive' },
  { code: 10, labelKey: 'input2Inactive', defaultAlarmHead: 'In2 Inactive' },
  { code: 11, labelKey: 'input3Inactive', defaultAlarmHead: 'In3 Inactive' },
  { code: 12, labelKey: 'input4Inactive', defaultAlarmHead: 'In4 Inactive' },
  { code: 13, labelKey: 'input5Inactive', defaultAlarmHead: 'In5 Inactive' },
  { code: 14, labelKey: 'input6Inactive', defaultAlarmHead: 'In6 Inactive' },
  { code: 15, labelKey: 'input7Inactive', defaultAlarmHead: 'In7 Inactive' },
  { code: 16, labelKey: 'input8Inactive', defaultAlarmHead: 'In8 Inactive' },
  { code: 17, labelKey: 'lowBattery', defaultAlarmHead: 'Low Battery' },
  { code: 18, labelKey: 'lowExtBattery', defaultAlarmHead: 'Low Ext-Battery' },
  { code: 19, labelKey: 'overspeed', defaultAlarmHead: 'Speeding' },
  { code: 20, labelKey: 'enterFence', defaultAlarmHead: 'Enter Fence' },
  { code: 21, labelKey: 'exitFence', defaultAlarmHead: 'Exit Fence' },
  { code: 22, labelKey: 'extBatteryOn', defaultAlarmHead: 'Ext-Battery On' },
  { code: 23, labelKey: 'extBatteryCut', defaultAlarmHead: 'Ext-Battery Cut' },
  { code: 24, labelKey: 'gpsLost', defaultAlarmHead: 'GPS Signal Lost' },
] as const;

export interface AssociatedPhone {
  number: string;
  sms: boolean;
  call: boolean;
}

export interface AlarmLinkSett {
  eventCode: number;
  alarmHead: string;
  delayRecordingSec: number;
  phones: AssociatedPhone[];
  transferGprs: boolean;
  /** FTP / VOICE: shown disabled — no 1:1 catalog toggle yet. */
  transferFtp: boolean;
  transferVoice: boolean;
  outputs: boolean[];
  /** Per channel 1..8 */
  channelRecording: boolean[];
  channelScreenshot: boolean[];
  channelOsd: boolean[];
}

export interface ComposedDeviceCommand {
  commandCode: string;
  params: Record<string, string | number>;
  /** Human hint for progress UI (not sent). */
  label: string;
  /** When true, UI should treat as informational skip. */
  unsupported?: boolean;
}

/** Phase 1C — which Link Sett controls actually encode to catalog commands. */
export const ALARM_LINK_SUPPORT = {
  transferGprs: true,
  transferFtp: false,
  transferVoice: false,
  /** Output1..Output7 */
  outputs: [true, true, false, false, false, false, false] as const,
  channelRecording: true,
  channelScreenshot: false,
  channelOsd: false,
} as const;

export function isOutputSupported(indexZeroBased: number): boolean {
  return Boolean(ALARM_LINK_SUPPORT.outputs[indexZeroBased]);
}

export type AlarmSnapshotSource = ParameterSnapshotSource;
export type AlarmLinkSnapshot = ParameterSnapshot<AlarmLinkSett>;

export function defaultLinkSett(event: AlarmParameterEventDef): AlarmLinkSett {
  return {
    eventCode: event.code,
    alarmHead: event.defaultAlarmHead,
    delayRecordingSec: 10,
    phones: [
      { number: '', sms: false, call: false },
      { number: '', sms: false, call: false },
      { number: '', sms: false, call: false },
    ],
    transferGprs: true,
    transferFtp: false,
    transferVoice: false,
    outputs: [false, false, false, false, false, false, false],
    channelRecording: [false, false, false, false, false, false, false, false],
    channelScreenshot: [false, false, false, false, false, false, false, false],
    channelOsd: [false, false, false, false, false, false, false, false],
  };
}

const B99 = {
  SMS: '0',
  CALL: '1',
  GPRS: '2',
  CAMERA: '3',
  OUT1: '5',
  OUT2: '6',
  GET: '0',
  ADD: '2',
} as const;

/**
 * Expand Link Sett into ordered Meitrack commands.
 * Unsupported toggles become `unsupported` entries (not sent).
 */
export function composeAlarmLinkSettCommands(sett: AlarmLinkSett): ComposedDeviceCommand[] {
  const out: ComposedDeviceCommand[] = [];
  const event = String(sett.eventCode);
  const head = sett.alarmHead.trim().slice(0, 16) || 'Alarm';

  out.push({
    commandCode: 'B91',
    params: { eventCode: sett.eventCode, header: head },
    label: 'B91 alarm head',
  });

  for (const phone of sett.phones) {
    const num = phone.number.trim();
    if (!num) continue;
    if (phone.sms) {
      out.push({
        commandCode: 'B99',
        params: {
          target: B99.SMS,
          phone: num,
          operation: B99.ADD,
          eventCodes: event,
        },
        label: `B99 SMS ${num}`,
      });
    }
    if (phone.call) {
      out.push({
        commandCode: 'B99',
        params: {
          target: B99.CALL,
          phone: num,
          operation: B99.ADD,
          eventCodes: event,
        },
        label: `B99 CALL ${num}`,
      });
    }
  }

  if (sett.transferGprs && ALARM_LINK_SUPPORT.transferGprs) {
    out.push({
      commandCode: 'B99',
      params: {
        target: B99.GPRS,
        operation: B99.ADD,
        eventCodes: event,
      },
      label: 'B99 GPRS',
    });
  }

  if (sett.transferFtp) {
    out.push({
      commandCode: 'FTP',
      params: {},
      label: 'FTP linkage',
      unsupported: true,
    });
  }

  if (sett.transferVoice) {
    out.push({
      commandCode: 'VOICE',
      params: {},
      label: 'VOICE linkage',
      unsupported: true,
    });
  }

  sett.outputs.forEach((on, idx) => {
    if (!on) return;
    const port = idx + 1;
    if (port === 1 && isOutputSupported(0)) {
      out.push({
        commandCode: 'B99',
        params: { target: B99.OUT1, operation: B99.ADD, eventCodes: event },
        label: 'B99 OUT1',
      });
    } else if (port === 2 && isOutputSupported(1)) {
      out.push({
        commandCode: 'B99',
        params: { target: B99.OUT2, operation: B99.ADD, eventCodes: event },
        label: 'B99 OUT2',
      });
    } else {
      out.push({
        commandCode: 'OUTn',
        params: { port },
        label: `Output ${port}`,
        unsupported: true,
      });
    }
  });

  const recChannels = sett.channelRecording
    .map((on, i) => (on ? i + 1 : null))
    .filter((n): n is number => n !== null);
  if (recChannels.length > 0 && ALARM_LINK_SUPPORT.channelRecording) {
    const delay = Math.max(0, Math.min(255, Math.round(sett.delayRecordingSec)));
    const entries = recChannels.map((ch) => `${sett.eventCode},${ch},${delay},1`).join(';');
    out.push({
      commandCode: 'CB8',
      params: { operation: '1', entries },
      label: 'CB8 event recording',
    });
  } else if (sett.delayRecordingSec > 0 && recChannels.length === 0) {
    out.push({
      commandCode: 'DELAY',
      params: { seconds: sett.delayRecordingSec },
      label: 'Delay recording (needs CH recording)',
      unsupported: true,
    });
  }

  sett.channelScreenshot.forEach((on, i) => {
    if (!on) return;
    out.push({
      commandCode: 'SHOT',
      params: { channel: i + 1 },
      label: `CH${i + 1} screenshot`,
      unsupported: true,
    });
  });
  sett.channelOsd.forEach((on, i) => {
    if (!on) return;
    out.push({
      commandCode: 'OSD',
      params: { channel: i + 1 },
      label: `CH${i + 1} OSD`,
      unsupported: true,
    });
  });

  return out;
}

export function sendableAlarmLinkCommands(sett: AlarmLinkSett): ComposedDeviceCommand[] {
  return composeAlarmLinkSettCommands(sett).filter((c) => !c.unsupported);
}

/** Live Refresh probes (single device). B91 has no readback in catalog. */
export function alarmReadbackCommands(): ComposedDeviceCommand[] {
  return [
    {
      commandCode: 'B99',
      params: { target: B99.GPRS, operation: B99.GET },
      label: 'B99 GPRS GET',
    },
    {
      commandCode: 'B99',
      params: { target: B99.OUT1, operation: B99.GET },
      label: 'B99 OUT1 GET',
    },
    {
      commandCode: 'B99',
      params: { target: B99.OUT2, operation: B99.GET },
      label: 'B99 OUT2 GET',
    },
    {
      commandCode: 'CB8',
      params: {},
      label: 'CB8 GET',
    },
  ];
}

export interface ParsedB99Auth {
  target: string;
  phone?: string;
  eventCodes: number[];
}

export interface ParsedCb8Entry {
  event: number;
  channel: number;
  seconds: number;
  priority: number;
}

/** Parse device B99 GET/SET reply into target + authorized event codes. */
export function parseB99AuthReply(responseText: string | null | undefined): ParsedB99Auth | null {
  if (!responseText) return null;
  const raw = responseText.trim();
  if (!raw) return null;
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const start = /^B99$/i.test(parts[0] ?? '') ? 1 : 0;
  const body = parts.slice(start);
  if (body.length === 0) return null;
  if (body.length === 1 && /^ok$/i.test(body[0] ?? '')) return null;

  const target = body[0] ?? '';
  if (!/^[0-6]$/.test(target)) return null;

  let idx = 1;
  let phone: string | undefined;
  if (target === B99.SMS || target === B99.CALL) {
    phone = body[idx++] ?? '';
  }
  const operation = body[idx];
  if (operation !== undefined && /^[0-3]$/.test(operation)) {
    idx += 1; // skip operation
  }
  const eventCodes: number[] = [];
  for (; idx < body.length; idx += 1) {
    const n = Number(body[idx]);
    if (Number.isFinite(n) && n > 0) eventCodes.push(n);
  }
  return { target, phone: phone || undefined, eventCodes };
}

/** Parse CB8 read reply (`CB8` / `CB8,1;event,ch,sec,prio;…`). */
export function parseCb8Reply(responseText: string | null | undefined): ParsedCb8Entry[] {
  if (!responseText) return [];
  const raw = responseText.trim();
  if (!raw || /^CB8,?\s*OK$/i.test(raw)) return [];
  let body = raw;
  if (/^CB8,/i.test(body)) body = body.slice(4);
  else if (/^CB8$/i.test(body)) return [];

  // Drop leading operation digit before first ';' if present: "1;19,1,10,1"
  const semi = body.indexOf(';');
  if (semi > 0 && /^[12]$/.test(body.slice(0, semi).trim())) {
    body = body.slice(semi + 1);
  }

  const out: ParsedCb8Entry[] = [];
  for (const group of body.split(';')) {
    const bits = group.split(',').map((s) => s.trim());
    if (bits.length < 3) continue;
    const event = Number(bits[0]);
    const channel = Number(bits[1]);
    const seconds = Number(bits[2]);
    const priority = Number(bits[3] ?? 1);
    if (![event, channel, seconds].every((n) => Number.isFinite(n) && n >= 0)) continue;
    if (event <= 0 || channel <= 0) continue;
    out.push({ event, channel, seconds, priority: Number.isFinite(priority) ? priority : 1 });
  }
  return out;
}

export function eventDefByCode(code: number): AlarmParameterEventDef | undefined {
  return ALARM_PARAMETER_EVENTS.find((e) => e.code === code);
}

function cloneSett(sett: AlarmLinkSett): AlarmLinkSett {
  return {
    ...sett,
    phones: sett.phones.map((p) => ({ ...p })),
    outputs: [...sett.outputs],
    channelRecording: [...sett.channelRecording],
    channelScreenshot: [...sett.channelScreenshot],
    channelOsd: [...sett.channelOsd],
  };
}

/** Ensure a mutable sett exists for every catalog event. */
export function loadSettMap(deviceId: string): Map<number, AlarmLinkSett> {
  const map = new Map<number, AlarmLinkSett>();
  for (const ev of ALARM_PARAMETER_EVENTS) {
    map.set(ev.code, cloneSett(loadCachedLinkSett(deviceId, ev)));
  }
  return map;
}

function ensurePhoneSlot(sett: AlarmLinkSett, phone: string): AssociatedPhone {
  const existing = sett.phones.find((p) => p.number.trim() === phone);
  if (existing) return existing;
  const empty = sett.phones.find((p) => !p.number.trim());
  if (empty) {
    empty.number = phone;
    return empty;
  }
  const created = { number: phone, sms: false, call: false };
  sett.phones.push(created);
  return created;
}

/** Merge one B99 auth reply across the event map. */
export function mergeB99AuthIntoSettMap(
  map: Map<number, AlarmLinkSett>,
  auth: ParsedB99Auth,
): void {
  const codeSet = new Set(auth.eventCodes);
  for (const ev of ALARM_PARAMETER_EVENTS) {
    const sett = map.get(ev.code);
    if (!sett) continue;
    const on = codeSet.has(ev.code);
    if (auth.target === B99.GPRS) {
      sett.transferGprs = on;
    } else if (auth.target === B99.OUT1) {
      sett.outputs[0] = on;
    } else if (auth.target === B99.OUT2) {
      sett.outputs[1] = on;
    } else if ((auth.target === B99.SMS || auth.target === B99.CALL) && auth.phone) {
      const slot = ensurePhoneSlot(sett, auth.phone);
      if (auth.target === B99.SMS) slot.sms = on;
      else slot.call = on;
      if (!on && !slot.sms && !slot.call) {
        // leave number; operator may still edit
      }
    }
  }
}

/** Merge CB8 entries into recording channels + delay. */
export function mergeCb8IntoSettMap(
  map: Map<number, AlarmLinkSett>,
  entries: ParsedCb8Entry[],
): void {
  const byEvent = new Map<number, ParsedCb8Entry[]>();
  for (const e of entries) {
    const list = byEvent.get(e.event) ?? [];
    list.push(e);
    byEvent.set(e.event, list);
  }
  for (const ev of ALARM_PARAMETER_EVENTS) {
    const sett = map.get(ev.code);
    if (!sett) continue;
    const list = byEvent.get(ev.code);
    if (!list || list.length === 0) continue;
    sett.channelRecording = sett.channelRecording.map(() => false);
    let delay = sett.delayRecordingSec;
    for (const row of list) {
      const idx = row.channel - 1;
      if (idx >= 0 && idx < sett.channelRecording.length) {
        sett.channelRecording[idx] = true;
      }
      delay = row.seconds;
    }
    sett.delayRecordingSec = delay;
  }
}

export interface CommandHistoryLike {
  readonly commandCode: string;
  readonly status: string;
  readonly params: Record<string, unknown> | null;
  readonly responseText: string | null;
}

/**
 * Merge ACKED history (SET params + any reply text) into the sett map.
 * Prefer reply text when present; otherwise use issued params.
 */
export function mergeHistoryIntoSettMap(
  map: Map<number, AlarmLinkSett>,
  history: readonly CommandHistoryLike[],
): boolean {
  let changed = false;
  for (const rec of history) {
    if (rec.status !== 'ACKED') continue;
    if (rec.commandCode === 'B91' && rec.params) {
      const code = Number(rec.params.eventCode);
      const header = String(rec.params.header ?? '').trim();
      const sett = map.get(code);
      if (sett && header) {
        sett.alarmHead = header.slice(0, 16);
        changed = true;
      }
      continue;
    }
    if (rec.commandCode === 'B99') {
      const fromReply = parseB99AuthReply(rec.responseText);
      if (fromReply && fromReply.eventCodes.length > 0) {
        mergeB99AuthIntoSettMap(map, fromReply);
        changed = true;
        continue;
      }
      if (rec.params) {
        const target = String(rec.params.target ?? '');
        const eventCodes = String(rec.params.eventCodes ?? '')
          .split(/[,;]/)
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (target && eventCodes.length > 0) {
          mergeB99AuthIntoSettMap(map, {
            target,
            phone: rec.params.phone ? String(rec.params.phone) : undefined,
            eventCodes,
          });
          changed = true;
        }
      }
      continue;
    }
    if (rec.commandCode === 'CB8') {
      const fromReply = parseCb8Reply(rec.responseText);
      if (fromReply.length > 0) {
        mergeCb8IntoSettMap(map, fromReply);
        changed = true;
        continue;
      }
      if (rec.params?.entries) {
        const fromParams = parseCb8Reply(`CB8,1;${String(rec.params.entries)}`);
        if (fromParams.length > 0) {
          mergeCb8IntoSettMap(map, fromParams);
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** Persist an entire sett map as snapshots with a shared source stamp. */
export function saveSettMap(
  deviceId: string,
  map: Map<number, AlarmLinkSett>,
  source: AlarmSnapshotSource,
): void {
  const updatedAt = new Date().toISOString();
  for (const sett of map.values()) {
    saveAlarmSnapshot(deviceId, { sett, source, updatedAt });
  }
}

export function cacheKey(deviceId: string, eventCode: number): string {
  return parameterCacheKey('alarm', deviceId, eventCode);
}

function isAlarmLinkSett(value: unknown): value is AlarmLinkSett {
  return Boolean(value && typeof value === 'object' && 'eventCode' in (value as object));
}

export function loadAlarmSnapshot(
  deviceId: string,
  event: AlarmParameterEventDef,
): AlarmLinkSnapshot {
  const snap = loadParameterSnapshot(
    cacheKey(deviceId, event.code),
    () => defaultLinkSett(event),
    isAlarmLinkSett,
  );
  if (snap.sett.eventCode !== event.code) {
    return stampParameterSnapshot(defaultLinkSett(event), 'default', new Date(0).toISOString());
  }
  return {
    ...snap,
    sett: { ...defaultLinkSett(event), ...snap.sett, eventCode: event.code },
  };
}

export function loadCachedLinkSett(deviceId: string, event: AlarmParameterEventDef): AlarmLinkSett {
  return loadAlarmSnapshot(deviceId, event).sett;
}

export function saveAlarmSnapshot(deviceId: string, snapshot: AlarmLinkSnapshot): void {
  saveParameterSnapshot(cacheKey(deviceId, snapshot.sett.eventCode), snapshot);
}

export function saveCachedLinkSett(
  deviceId: string,
  sett: AlarmLinkSett,
  source: AlarmSnapshotSource = 'set',
): void {
  saveAlarmSnapshot(deviceId, stampParameterSnapshot(sett, source));
}

export interface AlarmCachedSummary {
  alarmHead: string;
  delayRecordingSec: number;
  source: AlarmSnapshotSource;
  updatedAt: string;
}

export function loadAllCachedSummaries(deviceId: string): Map<number, AlarmCachedSummary> {
  const map = new Map<number, AlarmCachedSummary>();
  for (const ev of ALARM_PARAMETER_EVENTS) {
    const snap = loadAlarmSnapshot(deviceId, ev);
    map.set(ev.code, {
      alarmHead: snap.sett.alarmHead,
      delayRecordingSec: snap.sett.delayRecordingSec,
      source: snap.source,
      updatedAt: snap.updatedAt,
    });
  }
  return map;
}

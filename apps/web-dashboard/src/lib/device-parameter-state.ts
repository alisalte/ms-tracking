/**
 * Device Parameter — shared configuration state + readback foundation (Phase 2B).
 *
 * Alarm / Network (and later Media / AI) store a local snapshot that is not the
 * source of truth; the device is. Snapshots speed Refresh when protocol
 * readback is incomplete or multi-device mode cannot probe hardware.
 */

import { fetchDeviceCommand } from '@/api/command.api';
import type { BulkCommandResult, DeviceCommandRecord } from '@/types/command.types';

/** How the cached sett was last populated. */
export type ParameterSnapshotSource = 'set' | 'readback' | 'history' | 'default';

export interface ParameterSnapshot<T> {
  sett: T;
  source: ParameterSnapshotSource;
  updatedAt: string;
}

/** Shipped Parameter app sections (UI mounts all of these). */
export const PARAMETER_SECTION_DEFS = [
  { id: 'alarm', status: 'shipped' },
  { id: 'network', status: 'shipped' },
  { id: 'tracking', status: 'shipped' },
  { id: 'alerts', status: 'shipped' },
  { id: 'media', status: 'shipped' },
  { id: 'ai', status: 'shipped' },
] as const;

export type ParameterSectionId = (typeof PARAMETER_SECTION_DEFS)[number]['id'];
export type ShippedParameterSectionId = ParameterSectionId;

export const SHIPPED_PARAMETER_SECTIONS: readonly ShippedParameterSectionId[] = [
  'alarm',
  'network',
  'tracking',
  'alerts',
  'media',
  'ai',
];

const CACHE_ROOT = 'fv.deviceParameter.';

/** `fv.deviceParameter.<section>.<deviceId>[.<suffix>]` */
export function parameterCacheKey(
  section: ParameterSectionId | string,
  deviceId: string,
  suffix?: string | number,
): string {
  const base = `${CACHE_ROOT}${section}.${deviceId}`;
  return suffix === undefined || suffix === '' ? base : `${base}.${suffix}`;
}

export function emptyParameterSnapshot<T>(sett: T): ParameterSnapshot<T> {
  return {
    sett,
    source: 'default',
    updatedAt: new Date(0).toISOString(),
  };
}

export function loadParameterSnapshot<T>(
  key: string,
  createDefault: () => T,
  isSett?: (value: unknown) => value is T,
): ParameterSnapshot<T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyParameterSnapshot(createDefault());

    const parsed = JSON.parse(raw) as T | ParameterSnapshot<T>;
    if (parsed && typeof parsed === 'object' && 'sett' in parsed && parsed.sett) {
      const snap = parsed as ParameterSnapshot<T>;
      return {
        sett: { ...createDefault(), ...snap.sett },
        source: snap.source ?? 'set',
        updatedAt: snap.updatedAt ?? new Date(0).toISOString(),
      };
    }

    if (isSett && !isSett(parsed)) {
      return emptyParameterSnapshot(createDefault());
    }

    return {
      sett: { ...createDefault(), ...(parsed as T) },
      source: 'set',
      updatedAt: new Date(0).toISOString(),
    };
  } catch {
    return emptyParameterSnapshot(createDefault());
  }
}

export function saveParameterSnapshot<T>(key: string, snapshot: ParameterSnapshot<T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // ignore quota / private mode
  }
}

export function stampParameterSnapshot<T>(
  sett: T,
  source: ParameterSnapshotSource,
  updatedAt = new Date().toISOString(),
): ParameterSnapshot<T> {
  return { sett, source, updatedAt };
}

/**
 * Prefer live device merge, then ACKED history, else last local set/default.
 */
export function resolveParameterSource(opts: {
  gotLive: boolean;
  fromHistory: boolean;
  fallback?: ParameterSnapshotSource;
}): ParameterSnapshotSource {
  if (opts.gotLive) return 'readback';
  if (opts.fromHistory) return 'history';
  return opts.fallback ?? 'set';
}

/** i18n key under `commands.parameter.*` for a snapshot source chip. */
export function parameterSourceI18nKey(
  source: ParameterSnapshotSource,
): 'sourceReadback' | 'sourceHistory' | 'sourceSet' | 'sourceDefault' {
  switch (source) {
    case 'readback':
      return 'sourceReadback';
    case 'history':
      return 'sourceHistory';
    case 'set':
      return 'sourceSet';
    default:
      return 'sourceDefault';
  }
}

export const PARAMETER_SOURCE_DEFAULTS: Record<ParameterSnapshotSource, string> = {
  readback: 'device',
  history: 'history',
  set: 'last set',
  default: 'default',
};

export interface ParameterProbeCommand {
  commandCode: string;
  params: Record<string, string | number>;
  label: string;
}

export type IssueParameterCommand = (payload: {
  deviceIds: string[];
  commandCode: string;
  params: Record<string, string | number>;
}) => Promise<BulkCommandResult>;

export async function waitForParameterCommandAck(
  commandId: string,
  options?: {
    timeoutMs?: number;
    pollMs?: number;
    fetch?: (id: string) => Promise<DeviceCommandRecord>;
  },
): Promise<DeviceCommandRecord> {
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const pollMs = options?.pollMs ?? 2500;
  const fetchRow = options?.fetch ?? fetchDeviceCommand;
  const deadline = Date.now() + timeoutMs;
  let row = await fetchRow(commandId);
  while (Date.now() < deadline && (row.status === 'QUEUED' || row.status === 'SENT')) {
    await new Promise((r) => setTimeout(r, pollMs));
    row = await fetchRow(commandId);
  }
  return row;
}

/**
 * Issue ordered readback probes for one device. Soft-fails non-ACK replies so
 * partial protocol coverage (e.g. missing CB8) does not abort the whole Refresh.
 */
export async function runParameterProbes(opts: {
  deviceId: string;
  probes: readonly ParameterProbeCommand[];
  issue: IssueParameterCommand;
  onProgress?: (step: number, total: number, label: string) => void;
  /** Return true when the ACK contributed live device fields. */
  onAcked: (probe: ParameterProbeCommand, record: DeviceCommandRecord) => boolean | undefined;
  waitForAck?: typeof waitForParameterCommandAck;
}): Promise<{ gotLive: boolean }> {
  const wait = opts.waitForAck ?? waitForParameterCommandAck;
  let gotLive = false;

  for (const [i, probe] of opts.probes.entries()) {
    opts.onProgress?.(i + 1, opts.probes.length, probe.label);

    const result = await opts.issue({
      deviceIds: [opts.deviceId],
      commandCode: probe.commandCode,
      params: probe.params,
    });
    const queued = result.queued[0];
    if (!queued) {
      throw new Error(result.failed[0]?.error ?? 'Readback failed');
    }

    const done = await wait(queued.id);
    if (done.status !== 'ACKED') continue;

    if (opts.onAcked(probe, done)) gotLive = true;
  }

  return { gotLive };
}

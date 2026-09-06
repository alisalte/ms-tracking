/**
 * Collapse bulk-send history into one row per dispatch.
 *
 * POST /device-commands/bulk writes one row per device a few milliseconds
 * apart. Group consecutive records that share command + payload + issuer
 * within a short window so the table can say "sent to 10 devices" instead of
 * repeating the same command ten times.
 */
import type { DeviceCommandRecord } from '@/types/command.types';

const DEFAULT_WINDOW_MS = 8_000;

export interface CommandHistoryGroup {
  readonly id: string;
  readonly commandCode: string;
  readonly payloadText: string | null;
  readonly payloadHex: string | null;
  readonly issuedAt: string;
  readonly issuedBy: string | null;
  readonly records: readonly DeviceCommandRecord[];
}

function payloadKey(r: DeviceCommandRecord): string {
  return `${r.payloadText ?? ''}|${r.payloadHex ?? ''}`;
}

type MutableGroup = Omit<CommandHistoryGroup, 'records'> & {
  records: DeviceCommandRecord[];
};

export function groupCommandHistory(
  rows: readonly DeviceCommandRecord[],
  windowMs = DEFAULT_WINDOW_MS,
): CommandHistoryGroup[] {
  const sorted = [...rows].sort((a, b) => {
    const dt = new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime();
    if (dt !== 0) return dt;
    return a.id.localeCompare(b.id);
  });

  const groups: MutableGroup[] = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    const first = last?.records[0];
    const t = new Date(row.issuedAt).getTime();
    const canJoin =
      last &&
      first &&
      last.commandCode === row.commandCode &&
      last.issuedBy === row.issuedBy &&
      payloadKey(first) === payloadKey(row) &&
      t - new Date(last.issuedAt).getTime() <= windowMs;
    if (canJoin && last) {
      last.records.push(row);
    } else {
      groups.push({
        id: row.id,
        commandCode: row.commandCode,
        payloadText: row.payloadText,
        payloadHex: row.payloadHex,
        issuedAt: row.issuedAt,
        issuedBy: row.issuedBy,
        records: [row],
      });
    }
  }

  return groups.sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
}

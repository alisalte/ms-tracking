/**
 * CommandHistoryTable — command history. Single-device mode shows each
 * record with status + reply. Menu / type mode groups a bulk send into one
 * row ("sent to 10 devices"); expanding lists each IMEI and its reply.
 */
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  type BadgeProps,
  DataTable,
  type TableColumn,
  Tooltip,
} from '@/components/tailwind-ui';
import { groupCommandHistory } from '@/lib/command-history-groups';
import { formatDateTime } from '@/lib/format-date';
import type { CommandStatus, DeviceCommandRecord } from '@/types/command.types';

interface CommandHistoryTableProps {
  rows: DeviceCommandRecord[];
  loading?: boolean;
  /** When true, collapse bulk sends and expand per-device replies on click. */
  grouped?: boolean;
  /** deviceId → IMEI (or other caption) for expanded rows. */
  deviceLabel?: (deviceId: string) => string;
}

const STATUS_COLOR: Record<CommandStatus, BadgeProps['color']> = {
  QUEUED: 'warning',
  SENT: 'info',
  ACKED: 'success',
  FAILED: 'danger',
  EXPIRED: 'gray',
};

function StatusBadge({ status }: { status: CommandStatus }) {
  const { t } = useTranslation();
  return (
    <Badge color={STATUS_COLOR[status]} dot>
      {t(`commands.status.${status}`, { defaultValue: status })}
    </Badge>
  );
}

function ReplyCell({ row }: { row: DeviceCommandRecord }) {
  const text = row.responseText ?? row.error ?? '—';
  return (
    <Tooltip label={text}>
      <span
        className={`block max-w-[240px] truncate font-mono text-xs ${
          row.error
            ? 'text-danger-600 dark:text-danger-400'
            : 'text-gray-800 dark:text-graydark-800'
        }`}
      >
        {text}
      </span>
    </Tooltip>
  );
}

function PayloadCell({
  payloadText,
  payloadHex,
}: {
  payloadText: string | null;
  payloadHex: string | null;
}) {
  const text = (
    <span className="block max-w-[260px] truncate font-mono text-xs">
      {payloadText ?? (payloadHex ? `${payloadHex.slice(0, 24)}…` : '—')}
    </span>
  );
  return payloadHex ? <Tooltip label={`hex: ${payloadHex.slice(0, 120)}…`}>{text}</Tooltip> : text;
}

export function CommandHistoryTable({
  rows,
  loading,
  grouped = false,
  deviceLabel,
}: CommandHistoryTableProps) {
  const { t } = useTranslation();
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => (grouped ? groupCommandHistory(rows) : []), [grouped, rows]);

  const columns: Array<TableColumn<DeviceCommandRecord>> = [
    {
      id: 'issuedAt',
      headerKey: 'commands.history.time',
      width: 150,
      sortBy: (r) => r.issuedAt,
      render: (r) => (
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {formatDateTime(r.issuedAt)}
        </span>
      ),
    },
    {
      id: 'code',
      headerKey: 'commands.history.command',
      width: 90,
      sortBy: (r) => r.commandCode,
      render: (r) => <span className="font-mono text-xs font-semibold">{r.commandCode}</span>,
    },
    {
      id: 'payload',
      headerKey: 'commands.history.payload',
      render: (r) => <PayloadCell payloadText={r.payloadText} payloadHex={r.payloadHex} />,
    },
    {
      id: 'status',
      headerKey: 'commands.history.status',
      width: 110,
      sortBy: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      id: 'response',
      headerKey: 'commands.history.response',
      render: (r) => <ReplyCell row={r} />,
    },
  ];

  if (!grouped) {
    return (
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        maxHeight="calc(100vh - 420px)"
        emptyKey="commands.history.empty"
      />
    );
  }

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <DataTable
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        loading
        maxHeight="calc(100vh - 420px)"
        emptyKey="commands.history.empty"
      />
    );
  }

  if (groups.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-gray-500 dark:text-graydark-600">
        {t('commands.history.empty', { defaultValue: 'No commands sent yet.' })}
      </p>
    );
  }

  return (
    <div className="fv-scroll w-full overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-graydark-300">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 text-gray-500 dark:bg-graydark-200 dark:text-graydark-600">
          <tr>
            <th className="w-8 px-3 py-3" />
            <th className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold tracking-wide uppercase">
              {t('commands.history.time', { defaultValue: 'Time' })}
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold tracking-wide uppercase">
              {t('commands.history.command', { defaultValue: 'Command' })}
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold tracking-wide uppercase">
              {t('commands.history.payload', { defaultValue: 'Payload' })}
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-start text-xs font-semibold tracking-wide uppercase">
              {t('commands.history.sentTo', { defaultValue: 'Devices' })}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-white/5">
          {groups.map((group) => {
            const open = openIds.has(group.id);
            const count = group.records.length;
            const expandable = count > 1;
            return (
              <HistoryGroupRows
                key={group.id}
                groupId={group.id}
                commandCode={group.commandCode}
                payloadText={group.payloadText}
                payloadHex={group.payloadHex}
                issuedAt={group.issuedAt}
                records={group.records}
                open={open}
                expandable={expandable}
                count={count}
                deviceLabel={deviceLabel}
                onToggle={() => toggle(group.id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HistoryGroupRows({
  groupId,
  commandCode,
  payloadText,
  payloadHex,
  issuedAt,
  records,
  open,
  expandable,
  count,
  deviceLabel,
  onToggle,
}: {
  groupId: string;
  commandCode: string;
  payloadText: string | null;
  payloadHex: string | null;
  issuedAt: string;
  records: readonly DeviceCommandRecord[];
  open: boolean;
  expandable: boolean;
  count: number;
  deviceLabel?: (deviceId: string) => string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = expandable
    ? t('commands.history.sentToCount', {
        defaultValue: 'Sent to {{count}} devices',
        count,
      })
    : (deviceLabel?.(records[0]?.deviceId ?? '') ?? records[0]?.deviceId ?? '—');

  return (
    <>
      <tr
        data-testid={`command-history-group-${groupId}`}
        onClick={expandable ? onToggle : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggle();
                }
              }
            : undefined
        }
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        className={`${
          expandable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5' : ''
        } transition-colors`}
      >
        <td className="px-3 py-2.5 text-gray-400">
          {expandable ? (
            open ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} className="rtl:rotate-180" />
            )
          ) : null}
        </td>
        <td className="px-4 py-2.5 whitespace-nowrap text-xs text-gray-500 dark:text-graydark-600">
          {formatDateTime(issuedAt)}
        </td>
        <td className="px-4 py-2.5 font-mono text-xs font-semibold">{commandCode}</td>
        <td className="px-4 py-2.5">
          <PayloadCell payloadText={payloadText} payloadHex={payloadHex} />
        </td>
        <td className="px-4 py-2.5 text-sm text-gray-800 dark:text-graydark-800">{label}</td>
      </tr>
      {open &&
        expandable &&
        records.map((r) => (
          <tr
            key={r.id}
            className="bg-gray-50/80 dark:bg-white/[0.03]"
            data-testid="command-history-reply"
          >
            <td />
            <td
              className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-graydark-700"
              colSpan={2}
            >
              {deviceLabel?.(r.deviceId) ?? r.deviceId}
            </td>
            <td className="px-4 py-2">
              <StatusBadge status={r.status} />
            </td>
            <td className="px-4 py-2">
              <ReplyCell row={r} />
            </td>
          </tr>
        ))}
    </>
  );
}

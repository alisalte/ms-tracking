/**
 * CommandHistoryTable — the device's command history with live status badges
 * (QUEUED → SENT → ACKED/FAILED/EXPIRED). Polling is owned by the
 * useCommandHistory hook; this component is presentational.
 */
import { useTranslation } from 'react-i18next';

import {
  Badge,
  type BadgeProps,
  DataTable,
  type TableColumn,
  Tooltip,
} from '@/components/tailwind-ui';
import type { CommandStatus, DeviceCommandRecord } from '@/types/command.types';

interface CommandHistoryTableProps {
  rows: DeviceCommandRecord[];
  loading?: boolean;
}

/** Status → badge tone (single source for history table chips). */
const STATUS_COLOR: Record<CommandStatus, BadgeProps['color']> = {
  QUEUED: 'warning',
  SENT: 'info',
  ACKED: 'success',
  FAILED: 'danger',
  EXPIRED: 'gray',
};

export function CommandHistoryTable({ rows, loading }: CommandHistoryTableProps) {
  const { t } = useTranslation();

  const columns: Array<TableColumn<DeviceCommandRecord>> = [
    {
      id: 'issuedAt',
      headerKey: 'commands.history.time',
      width: 150,
      sortBy: (r) => r.issuedAt,
      render: (r) => (
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {new Date(r.issuedAt).toLocaleString()}
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
      render: (r) => {
        const text = (
          <span className="block max-w-[260px] truncate font-mono text-xs">
            {r.payloadText ?? (r.payloadHex ? `${r.payloadHex.slice(0, 24)}…` : '—')}
          </span>
        );
        // Tooltip only when there is a hex dump to reveal (MUI parity: empty
        // title never showed a tooltip).
        return r.payloadHex ? (
          <Tooltip label={`hex: ${r.payloadHex.slice(0, 120)}…`}>{text}</Tooltip>
        ) : (
          text
        );
      },
    },
    {
      id: 'status',
      headerKey: 'commands.history.status',
      width: 110,
      sortBy: (r) => r.status,
      render: (r) => (
        <Badge color={STATUS_COLOR[r.status]} dot>
          {t(`commands.status.${r.status}`, { defaultValue: r.status })}
        </Badge>
      ),
    },
    {
      id: 'response',
      headerKey: 'commands.history.response',
      render: (r) => {
        const text = r.responseText ?? r.error ?? '—';
        return (
          <Tooltip label={text}>
            <span
              className={`block max-w-[240px] truncate font-mono text-xs ${
                r.error
                  ? 'text-danger-600 dark:text-danger-400'
                  : 'text-gray-800 dark:text-graydark-800'
              }`}
            >
              {text}
            </span>
          </Tooltip>
        );
      },
    },
  ];

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

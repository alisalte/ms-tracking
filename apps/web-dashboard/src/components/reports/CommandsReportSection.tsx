/**
 * CommandsReportSection — tenant command history filtered to the report window.
 */
import type { ApexOptions } from 'apexcharts';
import { CheckCircle2, Send, Terminal, XCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDevices } from '@/api/asset.api';
import { useCommandHistory } from '@/api/command.api';
import type { ReportRange } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Badge, Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import { formatDateTime } from '@/lib/format-date';
import { isInReportRange } from '@/lib/report-format';
import { chart } from '@/theme/palette';
import type { CommandStatus, DeviceCommandRecord } from '@/types/command.types';

const STATUS_TONE: Record<CommandStatus, 'warning' | 'info' | 'success' | 'danger' | 'gray'> = {
  QUEUED: 'warning',
  SENT: 'info',
  ACKED: 'success',
  FAILED: 'danger',
  EXPIRED: 'gray',
};

const STATUS_COLOR: Record<CommandStatus, string> = {
  QUEUED: chart.idle,
  SENT: chart.distance,
  ACKED: chart.moving,
  FAILED: chart.offline,
  EXPIRED: chart.parked,
};

export function CommandsReportSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const history = useCommandHistory(null, undefined, { tenant: true });
  const devices = useDevices();

  const rows = useMemo(() => {
    const all = history.data ?? [];
    return all.filter((r) => isInReportRange(r.issuedAt, range));
  }, [history.data, range]);

  const deviceImei = useMemo(() => {
    return new Map((devices.data ?? []).map((d) => [d.id, d.imei]));
  }, [devices.data]);

  const counts = useMemo(() => {
    const c: Record<CommandStatus, number> = {
      QUEUED: 0,
      SENT: 0,
      ACKED: 0,
      FAILED: 0,
      EXPIRED: 0,
    };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const mix = (Object.keys(counts) as CommandStatus[])
    .map((status) => ({
      status,
      label: t(`commands.status.${status}`),
      value: counts[status],
      color: STATUS_COLOR[status],
    }))
    .filter((s) => s.value > 0);

  const donutOptions = useMemo<ApexOptions>(
    () => ({
      labels: mix.map((s) => s.label),
      colors: mix.map((s) => s.color),
      legend: { position: 'bottom' },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: true,
              total: { show: true, label: t('reports.commandsReport.issued') },
            },
          },
        },
      },
    }),
    [mix, t],
  );

  const columns: Column<DeviceCommandRecord>[] = [
    {
      id: 'issued',
      headerKey: 'reports.cols.start',
      render: (r) => formatDateTime(r.issuedAt),
    },
    {
      id: 'device',
      headerKey: 'reports.cols.device',
      render: (r) => deviceImei.get(r.deviceId) ?? r.deviceId,
    },
    { id: 'command', headerKey: 'reports.cols.command', render: (r) => r.commandCode },
    {
      id: 'status',
      headerKey: 'reports.cols.status',
      render: (r) => (
        <Badge color={STATUS_TONE[r.status]}>{t(`commands.status.${r.status}`)}</Badge>
      ),
    },
    {
      id: 'reply',
      headerKey: 'reports.cols.reply',
      render: (r) => r.responseText ?? r.error ?? '—',
    },
  ];

  if (history.isLoading) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
      <div className="flex flex-col gap-4" role="status">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder.
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-2xl" />
      </div>
    );
  }

  if (history.isError) {
    return <ErrorState error={history.error} onRetry={() => history.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="report-commands">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          labelKey="reports.commandsReport.issued"
          value={rows.length}
          icon={Send}
          tone="brand"
        />
        <KpiTile
          labelKey="reports.commandsReport.acked"
          value={counts.ACKED}
          icon={CheckCircle2}
          tone="success"
        />
        <KpiTile
          labelKey="reports.commandsReport.failed"
          value={counts.FAILED + counts.EXPIRED}
          icon={XCircle}
          tone={counts.FAILED > 0 ? 'danger' : 'gray'}
        />
        <KpiTile
          labelKey="reports.commandsReport.inFlight"
          value={counts.QUEUED + counts.SENT}
          icon={Terminal}
          tone="info"
        />
      </div>

      <Card>
        <CardHeader title={t('reports.charts.commandStatus')} />
        {mix.length === 0 ? (
          <EmptyChart label={t('reports.charts.empty')} />
        ) : (
          <ApexChart
            type="donut"
            series={mix.map((s) => s.value)}
            options={donutOptions}
            height={260}
          />
        )}
      </Card>

      <ReportsTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyKey="reports.empty"
        dense
      />
      <p className="text-xs text-gray-500 dark:text-graydark-600">
        {t('reports.commandsReport.note')}
      </p>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center">
      <p className="text-sm text-gray-500 dark:text-graydark-600">{label}</p>
    </div>
  );
}

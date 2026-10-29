/**
 * Device activity tab: one row per machine per day inside the range, grouped
 * by machine and sorted by day: when it started and stopped sending data, who
 * drove, how long it was offline and how far it travelled.
 */
import type { ApexOptions } from 'apexcharts';
import { Download, MapPin, RadioTower, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceActivityReport, DeviceActivityRow } from '@/api/operations.api';
import { StatCard } from '@/components/analytics/StatCard';
import {
  ChartPanel,
  OpsTable,
  Panel,
  barsHeight,
  clip,
  horizontalBar,
  hoursText,
  numText,
  round,
} from '@/components/operations/ops-ui';
import type { Column } from '@/components/reports/ReportsTable';
import { startEndColumns } from '@/components/reports/dateTimeColumns';
import { Badge, Button, Skeleton } from '@/components/tailwind-ui';
import { chart } from '@/theme/palette';

const TOP_MACHINES = 12;

export function ActivityTab({
  data,
  loading,
  failed,
  exporting,
  onExport,
}: {
  data: DeviceActivityReport | undefined;
  loading: boolean;
  failed: boolean;
  exporting: boolean;
  onExport: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const rows = data?.devices ?? [];
  const top = useMemo(
    () =>
      [...rows]
        .filter((row) => row.distanceKm > 0)
        .sort((a, b) => b.distanceKm - a.distanceKm)
        .slice(0, TOP_MACHINES),
    [rows],
  );
  // The machine is named once, on the first row of its group.
  const groupHeads = useMemo(() => {
    const seen = new Set<string>();
    const heads = new Set<DeviceActivityRow>();
    for (const row of rows) {
      if (seen.has(row.deviceId)) continue;
      seen.add(row.deviceId);
      heads.add(row);
    }
    return heads;
  }, [rows]);

  const distanceOptions = useMemo<ApexOptions>(
    () => ({
      colors: [chart.distance],
      ...horizontalBar(top.map((row) => clip(row.vehicleName ?? row.imei))),
      tooltip: {
        y: { formatter: (v: number) => `${numText(v, lang)} ${t('operations.ui.unitKm')}` },
      },
    }),
    [top, lang, t],
  );

  const statusOptions = useMemo<ApexOptions>(
    () => ({
      labels: [t('operations.reportingCount'), t('operations.silentCount')],
      colors: [chart.moving, chart.offline],
      legend: { position: 'bottom' },
      plotOptions: {
        pie: {
          donut: { labels: { total: { show: true, label: t('operations.ui.activity.total') } } },
        },
      },
    }),
    [t],
  );

  const columns: Array<Column<DeviceActivityRow>> = [
    {
      id: 'vehicle',
      headerKey: 'operations.colVehicle',
      render: (row) =>
        groupHeads.has(row) ? (
          <span className="font-semibold">{row.vehicleName ?? t('operations.unbound')}</span>
        ) : null,
    },
    {
      id: 'imei',
      headerKey: 'operations.colImei',
      render: (row) => (groupHeads.has(row) ? row.imei : null),
    },
    ...startEndColumns(
      (row: DeviceActivityRow) => row.startedAt,
      (row: DeviceActivityRow) => row.endedAt,
      lang,
    ),
    {
      id: 'driver',
      headerKey: 'operations.colDriver',
      render: (row) => row.driverName ?? '—',
    },
    {
      id: 'offline',
      headerKey: 'operations.colOffline',
      render: (row) => hoursText(row.offlineSec, lang),
    },
    {
      id: 'distance',
      headerKey: 'operations.colDistance',
      render: (row) => numText(row.distanceKm, lang),
    },
    {
      id: 'silent',
      headerKey: 'operations.colSilent',
      render: (row) => (
        <Badge color={row.silent ? 'danger' : 'success'} dot>
          {row.silent ? t('operations.silentYes') : t('operations.silentNo')}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="operations-activity">
      <Panel
        title={t('operations.activityTitle')}
        hint={t('operations.activityHint')}
        action={
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Download size={14} />}
            disabled={exporting || !data}
            data-testid="export-activity"
            onClick={onExport}
          >
            {exporting ? t('operations.exporting') : t('operations.exportExcel')}
          </Button>
        }
      >
        {failed && <p className="text-sm text-danger-600">{t('operations.loadFailed')}</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="activity-totals">
          <StatCard
            label={t('operations.totalDistance')}
            value={data ? numText(data.totalDistanceKm, lang) : '—'}
            unit={t('operations.ui.unitKm')}
            icon={MapPin}
            tone="brand"
            loading={loading && !data}
          />
          <StatCard
            label={t('operations.reportingCount')}
            value={data ? numText(data.reportingCount, lang, 0) : '—'}
            icon={RadioTower}
            tone="success"
            loading={loading && !data}
          />
          <StatCard
            label={t('operations.silentCount')}
            value={data ? numText(data.silentCount, lang, 0) : '—'}
            icon={WifiOff}
            tone={data && data.silentCount > 0 ? 'danger' : 'info'}
            loading={loading && !data}
          />
        </div>
      </Panel>

      {loading && !data ? (
        <Skeleton className="h-[280px] rounded-2xl" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ChartPanel
            className="lg:col-span-2"
            title={t('operations.ui.activity.chartDistance')}
            type="bar"
            series={[
              {
                name: t('operations.colDistance'),
                data: top.map((row) => round(row.distanceKm)),
              },
            ]}
            options={distanceOptions}
            height={barsHeight(top.length)}
            empty={top.length === 0}
          />
          <ChartPanel
            title={t('operations.ui.activity.chartStatus')}
            type="donut"
            series={data ? [data.reportingCount, data.silentCount] : []}
            options={statusOptions}
            height={280}
            empty={!data || data.reportingCount + data.silentCount === 0}
          />
        </div>
      )}

      <OpsTable
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.deviceId}|${row.day ?? ''}`}
      />
    </div>
  );
}

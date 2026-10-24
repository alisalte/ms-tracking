/**
 * Periods tab: the services of one route rolled up per day, week or month.
 */
import { CalendarRange, Download, Route, Timer, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import {
  type HaulPeriodReport,
  type OperationsRange,
  type PeriodCalendar,
  type PeriodGranularity,
  useHaulPeriods,
} from '@/api/operations.api';
import { StatCard } from '@/components/analytics/StatCard';
import {
  ChartPanel,
  OpsTable,
  Panel,
  comboChart,
  hoursText,
  numText,
  round,
} from '@/components/operations/ops-ui';
import type { Column } from '@/components/reports/ReportsTable';
import { Alert, Badge, Button, SegmentedControl, Skeleton } from '@/components/tailwind-ui';
import { periodLabel } from '@/lib/operations-export';

const GRANULARITIES: PeriodGranularity[] = ['daily', 'weekly', 'monthly'];
const CALENDARS: PeriodCalendar[] = ['jalali', 'gregorian'];
type View = 'summary' | 'details';

/** Axis label of a period: day and month for days and weeks, the month name for months. */
function chartLabel(
  row: { key: string; from: string; to: string },
  granularity: PeriodGranularity,
  calendar: PeriodCalendar,
  lang: string,
): string {
  if (granularity === 'monthly') return periodLabel(row, granularity, calendar, lang);
  const day = new Date(`${row.from}T12:00:00Z`);
  if (Number.isNaN(day.getTime())) return row.from;
  return day.toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: '2-digit',
  });
}

export function PeriodsTab({
  routeId,
  range,
  exporting,
  onExport,
}: {
  routeId: string;
  range: OperationsRange;
  exporting: boolean;
  onExport: (report: HaulPeriodReport) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [granularity, setGranularity] = useState<PeriodGranularity>('daily');
  const [calendar, setCalendar] = useState<PeriodCalendar>('jalali');
  const [view, setView] = useState<View>('summary');
  const report = useHaulPeriods(routeId, range, granularity, calendar);
  const data = report.data;

  const label = (row: { key: string; from: string; to: string }) =>
    periodLabel(row, granularity, calendar, lang);
  const labels = new Map((data?.periods ?? []).map((row) => [row.key, label(row)]));

  const periods = data?.periods ?? [];
  const combo = useMemo(
    () =>
      comboChart(
        periods.map((row) => chartLabel(row, granularity, calendar, lang)),
        { name: t('operations.colServices'), data: periods.map((row) => row.services) },
        {
          name: t('operations.colDistance'),
          data: periods.map((row) => round(row.distanceKm)),
          unit: t('operations.ui.unitKm'),
        },
        lang,
      ),
    [periods, granularity, calendar, lang, t],
  );

  const totalSec = periods.reduce((sum, row) => sum + row.durationSec, 0);
  const loadSec = periods.reduce((sum, row) => sum + row.loadDwellSec, 0);
  const busiest = periods.reduce<(typeof periods)[number] | null>(
    (best, row) => (row.services > (best?.services ?? 0) ? row : best),
    null,
  );

  const periodColumns: Array<Column<HaulPeriodReport['periods'][number]>> = [
    { id: 'period', headerKey: 'operations.colPeriod', render: (row) => label(row) },
    {
      id: 'services',
      headerKey: 'operations.colServices',
      render: (row) => numText(row.services, lang, 0),
    },
    {
      id: 'distance',
      headerKey: 'operations.colDistance',
      render: (row) => numText(row.distanceKm, lang),
    },
    {
      id: 'load',
      headerKey: 'operations.colLoad',
      render: (row) => hoursText(row.loadDwellSec, lang),
    },
    {
      id: 'hours',
      headerKey: 'operations.colHours',
      render: (row) => hoursText(row.durationSec, lang),
    },
    {
      id: 'trucks',
      headerKey: 'operations.colTrucks',
      render: (row) => numText(row.trucks, lang, 0),
    },
    {
      id: 'drivers',
      headerKey: 'operations.colDrivers',
      render: (row) => numText(row.drivers, lang, 0),
    },
    {
      id: 'without',
      headerKey: 'operations.colWithoutDriver',
      render: (row) =>
        row.withoutDriver > 0 ? (
          <Badge color="warning">{numText(row.withoutDriver, lang, 0)}</Badge>
        ) : (
          numText(0, lang, 0)
        ),
    },
  ];

  const detailColumns: Array<Column<HaulPeriodReport['details'][number]>> = [
    {
      id: 'period',
      headerKey: 'operations.colPeriod',
      render: (row) => labels.get(row.period) ?? row.period,
    },
    { id: 'vehicle', headerKey: 'operations.colVehicle', render: (row) => row.vehicleName },
    {
      id: 'shift',
      headerKey: 'operations.colShift',
      render: (row) =>
        row.shiftNo > 0 ? t('operations.shiftN', { n: row.shiftNo }) : t('operations.offShift'),
    },
    { id: 'driver', headerKey: 'operations.colDriver', render: (row) => row.driverName ?? '—' },
    {
      id: 'services',
      headerKey: 'operations.colServices',
      render: (row) => numText(row.services, lang, 0),
    },
    {
      id: 'distance',
      headerKey: 'operations.colDistance',
      render: (row) => numText(row.distanceKm, lang),
    },
    {
      id: 'hours',
      headerKey: 'operations.colHours',
      render: (row) => hoursText(row.durationSec, lang),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="haul-periods">
      <Panel
        title={t('operations.periodsTitle')}
        hint={t('operations.periodsHint')}
        action={
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Download size={14} />}
            disabled={exporting || !data}
            data-testid="export-periods"
            onClick={() => data && onExport(data)}
          >
            {exporting ? t('operations.exporting') : t('operations.exportExcel')}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            aria-label={t('operations.periodsTitle')}
            size="sm"
            value={granularity}
            onChange={setGranularity}
            options={GRANULARITIES.map((value) => ({
              value,
              label: t(`operations.granularity.${value}`),
            }))}
          />
          {granularity === 'monthly' && (
            <SegmentedControl
              aria-label={t('operations.calendar.jalali')}
              size="sm"
              value={calendar}
              onChange={setCalendar}
              options={CALENDARS.map((value) => ({
                value,
                label: t(`operations.calendar.${value}`),
              }))}
            />
          )}
        </div>
      </Panel>

      {report.isError && <Alert variant="danger">{getApiErrorMessage(report.error)}</Alert>}
      {data?.truncated && <Alert variant="warning">{t('operations.truncated')}</Alert>}
      {report.isLoading && !data && <Skeleton className="h-[320px] rounded-2xl" />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label={t('operations.ui.periods.kpiServices')}
              value={numText(data.services, lang, 0)}
              icon={Truck}
              tone="brand"
            />
            <StatCard
              label={t('operations.ui.periods.kpiDistance')}
              value={numText(data.distanceKm, lang)}
              unit={t('operations.ui.unitKm')}
              icon={Route}
              tone="info"
            />
            <StatCard
              label={t('operations.ui.periods.kpiHours')}
              value={hoursText(totalSec, lang)}
              unit={t('operations.ui.unitH')}
              hint={`${t('operations.ui.periods.kpiLoad')}: ${hoursText(loadSec, lang)} ${t('operations.ui.unitH')}`}
              icon={Timer}
              tone="success"
            />
            <StatCard
              label={t('operations.ui.periods.kpiBusiest')}
              value={busiest ? numText(busiest.services, lang, 0) : '—'}
              hint={busiest ? label(busiest) : undefined}
              icon={CalendarRange}
              tone="warning"
            />
          </div>

          <ChartPanel
            title={t('operations.ui.periods.chartTitle')}
            type="line"
            series={combo.series}
            options={combo.options}
            empty={periods.length === 0 || data.services === 0}
          />

          <SegmentedControl
            aria-label={t('operations.ui.periods.viewsLabel')}
            value={view}
            onChange={setView}
            className="self-start"
            options={(['summary', 'details'] as const).map((value) => ({
              value,
              label: t(`operations.ui.periods.views.${value}`),
            }))}
          />

          {view === 'summary' && (
            <OpsTable
              testId="haul-period-table"
              columns={periodColumns}
              rows={periods}
              rowKey={(row) => row.key}
            />
          )}
          {view === 'details' &&
            (data.details.length === 0 ? (
              <Alert variant="info">{t('operations.periodsEmpty')}</Alert>
            ) : (
              <Panel title={t('operations.detailTitle')}>
                <OpsTable
                  testId="haul-period-details"
                  columns={detailColumns}
                  rows={data.details}
                  rowKey={(row) =>
                    `${row.period}|${row.vehicleId}|${row.shiftNo}|${row.driverId ?? ''}`
                  }
                />
              </Panel>
            ))}
        </>
      )}
    </div>
  );
}

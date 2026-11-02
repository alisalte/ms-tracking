/**
 * Drivers & shifts tab: services, working hours and kilometres of every truck
 * per shift (day / night) and of every driver per day and per month, plus the
 * trucks each driver worked on. Working time is engine-on or moving time from
 * the truck's own track; the Excel file is built by the server, the same one
 * a scheduled report emails.
 *
 * Other routes can be added to the one picked in the toolbar — a day-shift
 * route and a night-shift route then read as one work day, each route's shift
 * a column of its own. The added routes are remembered in this browser.
 */
import { Clock, Download, Route, Truck, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import {
  type HaulDriverPeriodRow,
  type HaulDriverWorkRow,
  type HaulShiftReport,
  type OperationsRange,
  type PeriodCalendar,
  downloadHaulShiftsExcel,
  useHaulShifts,
} from '@/api/operations.api';
import { StatCard } from '@/components/analytics/StatCard';
import {
  ChartPanel,
  OpsTable,
  Panel,
  barsHeight,
  horizontalBar,
  hoursText,
  numText,
} from '@/components/operations/ops-ui';
import type { Column } from '@/components/reports/ReportsTable';
import { Alert, Button, Checkbox, SegmentedControl, Skeleton } from '@/components/tailwind-ui';
import { formatWorkDay, periodLabel } from '@/lib/operations-export';

const CALENDARS: PeriodCalendar[] = ['jalali', 'gregorian'];
type View = 'drivers' | 'trucks' | 'driverDays' | 'driverMonths';
const VIEWS: View[] = ['drivers', 'trucks', 'driverDays', 'driverMonths'];

/** One truck on one work day, every shift side by side. */
interface TruckDay {
  key: string;
  day: string;
  vehicleName: string;
  services: number[];
  workSec: number[];
  distanceKm: number;
  drivers: string[];
}

/** Shift numbers in the data, route shifts first and off-shift last. */
function shiftNumbers(report: HaulShiftReport): number[] {
  const seen = new Set<number>(report.shifts.map((s) => s.no));
  for (const row of report.trucks) seen.add(row.shiftNo);
  return [...seen].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
}

function truckDays(report: HaulShiftReport, shifts: number[]): TruckDay[] {
  const out = new Map<string, TruckDay & { names: Set<string> }>();
  for (const row of report.trucks) {
    const key = `${row.day}|${row.vehicleId}`;
    let acc = out.get(key);
    if (!acc) {
      acc = {
        key,
        day: row.day,
        vehicleName: row.vehicleName,
        services: shifts.map(() => 0),
        workSec: shifts.map(() => 0),
        distanceKm: 0,
        drivers: [],
        names: new Set(),
      };
      out.set(key, acc);
    }
    const i = shifts.indexOf(row.shiftNo);
    if (i >= 0) {
      acc.services[i] = (acc.services[i] ?? 0) + row.services;
      acc.workSec[i] = (acc.workSec[i] ?? 0) + row.workSec;
    }
    acc.distanceKm += row.distanceKm;
    for (const name of row.driverNames) acc.names.add(name);
  }
  return [...out.values()].map(({ names, ...row }) => ({ ...row, drivers: [...names] }));
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const EXTRA_ROUTES_KEY = 'fleetvision.operations.shiftRoutes';

function loadExtraRoutes(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(EXTRA_ROUTES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveExtraRoutes(ids: string[]): void {
  try {
    localStorage.setItem(EXTRA_ROUTES_KEY, JSON.stringify(ids));
  } catch {
    // Private mode or blocked storage: the choice just is not remembered.
  }
}

export function ShiftsTab({
  routeId,
  routes,
  range,
}: {
  routeId: string;
  /** Active routes that can be read together with `routeId`. */
  routes: ReadonlyArray<{ id: string; name: string }>;
  range: OperationsRange;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [calendar, setCalendar] = useState<PeriodCalendar>('jalali');
  const [view, setView] = useState<View>('drivers');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>(loadExtraRoutes);
  const routeIds = useMemo(
    () => [
      routeId,
      ...extra.filter((id) => id !== routeId && routes.some((route) => route.id === id)),
    ],
    [routeId, extra, routes],
  );
  const toggleRoute = (id: string, on: boolean) => {
    const next = on ? [...extra.filter((x) => x !== id), id] : extra.filter((x) => x !== id);
    setExtra(next);
    saveExtraRoutes(next);
  };
  const report = useHaulShifts(routeIds, range, calendar);
  const data = report.data;

  const shifts = useMemo(() => (data ? shiftNumbers(data) : []), [data]);
  /** Day / night for one of each; the route (and its shift) when several are read together. */
  const shiftName = (no: number) => {
    if (no === 0) return t('operations.offShift');
    const info = data?.shifts.find((s) => s.no === no);
    if (info?.kind) return t(`operations.shifts.${info.kind}`);
    if (info && (data?.routes.length ?? 0) > 1) {
      return info.routeShiftCount > 1
        ? `${info.routeName} · ${t('operations.shiftN', { n: info.routeShiftNo })}`
        : info.routeName;
    }
    return t('operations.shiftN', { n: no });
  };
  const list = (items: readonly string[]) =>
    items.length ? items.join(lang === 'fa' ? '، ' : ', ') : '—';
  const monthText = (row: HaulDriverPeriodRow) =>
    periodLabel({ key: row.period, from: row.from, to: row.to }, 'monthly', calendar, lang);
  const days = useMemo(() => (data ? truckDays(data, shifts) : []), [data, shifts]);

  const exportExcel = async () => {
    if (!data) return;
    setExporting(true);
    setExportError(null);
    try {
      await downloadHaulShiftsExcel(
        routeIds,
        range,
        calendar,
        lang,
        `${data.routes.map((route) => route.name).join('-')}-${t('operations.shifts.title')}`,
      );
    } catch (err) {
      setExportError(getApiErrorMessage(err) ?? t('operations.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const topDrivers = [...(data?.drivers ?? [])]
    .sort((a, b) => b.services - a.services)
    .slice(0, 15);
  const chartSeries = shifts.map((no) => ({
    name: shiftName(no),
    data: topDrivers.map((row) => row.servicesByShift[String(no)] ?? 0),
  }));
  const chartOptions = {
    chart: { stacked: true },
    ...horizontalBar(topDrivers.map((row) => row.driverName)),
  };

  const driverColumns: Array<Column<HaulDriverWorkRow>> = [
    { id: 'driver', headerKey: 'operations.colDriver', render: (row) => row.driverName },
    {
      id: 'services',
      headerKey: 'operations.colServices',
      render: (row) => numText(row.services, lang, 0),
    },
    ...shifts.map((no) => ({
      id: `shift-${no}`,
      header: `${t('operations.colServices')} · ${shiftName(no)}`,
      render: (row: HaulDriverWorkRow) => numText(row.servicesByShift[String(no)] ?? 0, lang, 0),
    })),
    {
      id: 'shifts',
      headerKey: 'operations.shifts.colShifts',
      render: (row) => numText(row.shifts, lang, 0),
    },
    {
      id: 'perShift',
      headerKey: 'operations.shifts.colPerShift',
      render: (row) => numText(row.shifts > 0 ? row.services / row.shifts : 0, lang),
    },
    {
      id: 'hours',
      headerKey: 'operations.shifts.colWorkHours',
      render: (row) => hoursText(row.workSec, lang),
    },
    {
      id: 'distance',
      headerKey: 'operations.shifts.colDistance',
      render: (row) => numText(row.distanceKm, lang),
    },
    {
      id: 'trucks',
      headerKey: 'operations.shifts.colTrucks',
      render: (row) => list(row.vehicleNames),
    },
  ];

  const truckColumns: Array<Column<TruckDay>> = [
    {
      id: 'day',
      headerKey: 'operations.shifts.colDate',
      render: (row) => formatWorkDay(row.day, lang),
    },
    { id: 'truck', headerKey: 'operations.shifts.colTruck', render: (row) => row.vehicleName },
    ...shifts.map((no, i) => ({
      id: `services-${no}`,
      header: `${t('operations.colServices')} · ${shiftName(no)}`,
      render: (row: TruckDay) => numText(row.services[i] ?? 0, lang, 0),
    })),
    ...shifts.map((no, i) => ({
      id: `hours-${no}`,
      header: `${t('operations.shifts.colWorkHours')} · ${shiftName(no)}`,
      render: (row: TruckDay) => hoursText(row.workSec[i] ?? 0, lang),
    })),
    {
      id: 'total',
      headerKey: 'operations.shifts.colTotalServices',
      render: (row) => numText(sum(row.services), lang, 0),
    },
    {
      id: 'totalHours',
      headerKey: 'operations.shifts.colTotalHours',
      render: (row) => hoursText(sum(row.workSec), lang),
    },
    { id: 'drivers', headerKey: 'operations.colDrivers', render: (row) => list(row.drivers) },
  ];

  const workColumns = (month: boolean): Array<Column<HaulDriverPeriodRow>> => [
    month
      ? { id: 'month', headerKey: 'operations.shifts.colMonth', render: monthText }
      : {
          id: 'day',
          headerKey: 'operations.shifts.colDate',
          render: (row) => formatWorkDay(row.period, lang),
        },
    { id: 'driver', headerKey: 'operations.colDriver', render: (row) => row.driverName },
    {
      id: 'hours',
      headerKey: 'operations.shifts.colWorkHours',
      render: (row) => hoursText(row.workSec, lang),
    },
    {
      id: 'distance',
      headerKey: 'operations.shifts.colDistance',
      render: (row) => numText(row.distanceKm, lang),
    },
    {
      id: 'services',
      headerKey: 'operations.colServices',
      render: (row) => numText(row.services, lang, 0),
    },
    ...(month
      ? [
          {
            id: 'days',
            headerKey: 'operations.shifts.colDays',
            render: (row: HaulDriverPeriodRow) => numText(row.days, lang, 0),
          },
          {
            id: 'truckCount',
            headerKey: 'operations.shifts.colTruckCount',
            render: (row: HaulDriverPeriodRow) => numText(row.vehicleNames.length, lang, 0),
          },
        ]
      : []),
    {
      id: 'trucks',
      headerKey: 'operations.shifts.colTrucks',
      render: (row) => list(row.vehicleNames),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="haul-shifts">
      <Panel
        title={t('operations.shifts.title')}
        hint={t('operations.shifts.hint')}
        action={
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Download size={14} />}
            disabled={exporting || !data}
            data-testid="export-shifts"
            onClick={() => void exportExcel()}
          >
            {exporting ? t('operations.exporting') : t('operations.exportExcel')}
          </Button>
        }
      >
        {routes.length > 1 && (
          <fieldset className="mb-3" data-testid="shift-routes">
            <legend className="mb-1.5 text-xs font-medium text-gray-600 dark:text-graydark-600">
              {t('operations.shifts.routesLabel')}
            </legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {routes.map((route) => (
                <Checkbox
                  key={route.id}
                  label={route.name}
                  checked={routeIds.includes(route.id)}
                  disabled={route.id === routeId}
                  onChange={(event) => toggleRoute(route.id, event.target.checked)}
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-graydark-600">
              {t('operations.shifts.routesHint')}
            </p>
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            aria-label={t('operations.shifts.viewsLabel')}
            size="sm"
            value={view}
            onChange={setView}
            options={VIEWS.map((value) => ({
              value,
              label: t(`operations.shifts.views.${value}`),
            }))}
          />
          {view === 'driverMonths' && (
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

      {exportError && <Alert variant="warning">{exportError}</Alert>}
      {report.isError && <Alert variant="danger">{getApiErrorMessage(report.error)}</Alert>}
      {data?.truncated && <Alert variant="warning">{t('operations.truncated')}</Alert>}
      {report.isLoading && !data && <Skeleton className="h-[320px] rounded-2xl" />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label={t('operations.shifts.kpiServices')}
              value={numText(data.services, lang, 0)}
              icon={Truck}
              tone="brand"
            />
            <StatCard
              label={t('operations.shifts.kpiHours')}
              value={hoursText(data.workSec, lang)}
              unit={t('operations.ui.unitH')}
              icon={Clock}
              tone="success"
            />
            <StatCard
              label={t('operations.shifts.kpiDistance')}
              value={numText(data.distanceKm, lang)}
              unit={t('operations.ui.unitKm')}
              icon={Route}
              tone="info"
            />
            <StatCard
              label={t('operations.shifts.kpiDrivers')}
              value={numText(data.drivers.length, lang, 0)}
              icon={Users}
              tone="warning"
            />
          </div>

          {view === 'drivers' && (
            <>
              <ChartPanel
                title={t('operations.shifts.chartTitle')}
                type="bar"
                series={chartSeries}
                options={chartOptions}
                height={barsHeight(topDrivers.length)}
                empty={topDrivers.length === 0}
              />
              <OpsTable
                testId="shift-drivers"
                columns={driverColumns}
                rows={data.drivers}
                rowKey={(row) => row.driverId}
                emptyKey="operations.shifts.empty"
              />
            </>
          )}
          {view === 'trucks' && (
            <OpsTable
              testId="shift-trucks"
              columns={truckColumns}
              rows={days}
              rowKey={(row) => row.key}
              emptyKey="operations.shifts.empty"
            />
          )}
          {view === 'driverDays' && (
            <OpsTable
              testId="shift-driver-days"
              columns={workColumns(false)}
              rows={data.driverDays}
              rowKey={(row) => `${row.period}|${row.driverId}`}
              emptyKey="operations.shifts.empty"
            />
          )}
          {view === 'driverMonths' && (
            <OpsTable
              testId="shift-driver-months"
              columns={workColumns(true)}
              rows={data.driverMonths}
              rowKey={(row) => `${row.period}|${row.driverId}`}
              emptyKey="operations.shifts.empty"
            />
          )}
        </>
      )}
    </div>
  );
}

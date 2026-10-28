/**
 * Wasted-time analysis of a haul route (`/operations`).
 *
 * Splits every service into loading, loaded haul, unloading and empty return,
 * measures each against a reference (the fleet's own best quartile, or a
 * target the operator types), and shows who and what loses the time: drivers,
 * trucks, shifts, shovels and long stops outside the origin and destination.
 */
import type { ApexOptions } from 'apexcharts';
import {
  Download,
  Hourglass,
  Percent,
  Timer,
  TriangleAlert,
  Truck,
  UserX,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import {
  type AnalysisFindingCode,
  type AnalysisPhase,
  type AnalysisTargets,
  type HaulAnalysisReport,
  type OperationsRange,
  useHaulAnalysis,
} from '@/api/operations.api';
import { StatCard } from '@/components/analytics/StatCard';
import { HaulLiveAlerts } from '@/components/operations/HaulLiveAlerts';
import {
  ChartPanel,
  OpsTable,
  Panel,
  barsHeight,
  clip,
  horizontalBar,
  hoursText,
  minutesText,
  numText,
  round,
} from '@/components/operations/ops-ui';
import type { Column } from '@/components/reports/ReportsTable';
import { startEndColumns } from '@/components/reports/dateTimeColumns';
import { Alert, Badge, Button, Input, SegmentedControl, Skeleton } from '@/components/tailwind-ui';
import { formatWorkDay, minutesOf } from '@/lib/operations-export';
import { apex } from '@/theme/palette';

const PHASES: AnalysisPhase[] = ['load', 'travel', 'unload', 'return'];
const PHASE_COLORS = [apex.orange, apex.blue, apex.purple, apex.cyan];
const TARGET_FIELDS: Array<{ key: keyof AnalysisTargets; label: string }> = [
  { key: 'targetLoadMin', label: 'targetLoad' },
  { key: 'targetTravelMin', label: 'targetTravel' },
  { key: 'targetUnloadMin', label: 'targetUnload' },
  { key: 'targetReturnMin', label: 'targetReturn' },
  { key: 'stopMin', label: 'targetStop' },
];
const BUDGET_KEYS = [
  'origin',
  'destination',
  'moving',
  'idleOutside',
  'parked',
  'noData',
  'lunch',
  'handover',
] as const;
const BUDGET_COLORS = [
  apex.orange,
  apex.purple,
  apex.green,
  apex.yellow,
  apex.slate,
  apex.red,
  apex.blue,
  apex.magenta,
];
/** Findings whose value / reference are seconds and read better as minutes. */
const MINUTE_FINDINGS: Partial<
  Record<AnalysisFindingCode, { value: boolean; reference: boolean }>
> = {
  DRIVER_SLOW_LOAD: { value: true, reference: true },
  DRIVER_SLOW_UNLOAD: { value: true, reference: true },
  DRIVER_LONG_STOPS: { value: true, reference: false },
  SHOVEL_QUEUE: { value: true, reference: false },
  SHOVEL_STARVED: { value: true, reference: false },
  LOAD_IS_BIGGEST: { value: true, reference: true },
  LOW_DATA: { value: true, reference: true },
};

type View = 'overview' | 'drivers' | 'vehicles' | 'shifts' | 'stops' | 'alerts';
const VIEWS: View[] = ['overview', 'drivers', 'vehicles', 'shifts', 'stops', 'alerts'];

const min = (sec: number | null | undefined) =>
  sec === null || sec === undefined ? 0 : round(sec / 60);

export function HaulAnalysisSection({
  routeId,
  range,
  exporting,
  onExport,
}: {
  routeId: string | null;
  range: OperationsRange;
  exporting: boolean;
  onExport: (report: HaulAnalysisReport) => void;
}) {
  const { t, i18n } = useTranslation();
  const a = (key: string, options?: Record<string, unknown>) =>
    t(`operations.analysis.${key}`, options);
  const [draft, setDraft] = useState<AnalysisTargets>({});
  const [targets, setTargets] = useState<AnalysisTargets>({});
  const [view, setView] = useState<View>('overview');
  const report = useHaulAnalysis(routeId, range, targets);
  const data = report.data;
  const lang = i18n.language;

  const shiftLabel = (row: { shift: string; shiftDate: string | null; shiftNo: number }) =>
    row.shift === 'off-shift' || !row.shiftDate
      ? t('operations.offShift')
      : `${formatWorkDay(row.shiftDate, lang)} · ${t('operations.shiftN', { n: row.shiftNo })}`;

  const findingText = (row: HaulAnalysisReport['findings'][number]) => {
    const unit = MINUTE_FINDINGS[row.code];
    const toMin = (sec: number) => Math.round((sec / 60) * 10) / 10;
    return a(`findings.${row.code}`, {
      subject: row.subjectLabel ?? '',
      value: unit?.value ? toMin(row.value) : row.value,
      reference:
        row.reference === null ? '' : unit?.reference ? toMin(row.reference) : row.reference,
    });
  };

  const phaseName = (phase: AnalysisPhase) => a(`phase.${phase}`).replace(/\s*\(.*\)$/, '');
  const m = (sec: number | null) => minutesText(sec, lang);

  return (
    <div className="flex flex-col gap-4" data-testid="haul-analysis">
      <Panel
        title={a('title')}
        hint={a('hint')}
        action={
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Download size={14} />}
            disabled={exporting || !data}
            data-testid="export-analysis"
            onClick={() => data && onExport(data)}
          >
            {exporting ? t('operations.exporting') : t('operations.exportExcel')}
          </Button>
        }
      >
        <details className="group rounded-xl border border-gray-200 dark:border-white/10">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-semibold text-gray-700 dark:text-graydark-800">
            <span>
              {t('operations.ui.analysis.targetsToggle')}
              {Object.values(targets).some((v) => v !== undefined && v !== '') && (
                <Badge color="brand" className="ms-2">
                  {Object.values(targets).filter((v) => v !== undefined && v !== '').length}
                </Badge>
              )}
            </span>
            <span aria-hidden className="text-gray-400 transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <form
            className="border-t border-gray-200 px-3.5 py-3 dark:border-white/10"
            data-testid="analysis-targets"
            onSubmit={(event) => {
              event.preventDefault();
              setTargets(draft);
            }}
          >
            <h3 className="text-sm font-semibold">{a('targetsTitle')}</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-graydark-600">{a('targetsHint')}</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              {TARGET_FIELDS.map(({ key, label }) => (
                <Input
                  key={key}
                  label={a(label)}
                  type="number"
                  min={1}
                  max={1440}
                  step="any"
                  inputMode="decimal"
                  placeholder={a('auto')}
                  data-testid={`analysis-${key}`}
                  wrapperClassName="w-32"
                  value={draft[key] ?? ''}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
                />
              ))}
              <Button size="sm" type="submit" data-testid="analysis-apply">
                {a('apply')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => {
                  setDraft({});
                  setTargets({});
                }}
              >
                {a('reset')}
              </Button>
            </div>
          </form>
        </details>
      </Panel>

      {report.isError && <Alert variant="danger">{getApiErrorMessage(report.error)}</Alert>}
      {data?.truncated && <Alert variant="warning">{t('operations.truncated')}</Alert>}
      {report.isLoading && !data && <Skeleton className="h-[320px] rounded-2xl" />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="analysis-kpis">
            <StatCard
              label={a('kpiServices')}
              value={<span data-testid="kpi-services">{numText(data.services, lang, 0)}</span>}
              icon={Truck}
              tone="brand"
            />
            <StatCard
              label={a('kpiMedianCycle')}
              value={m(data.cycleMedianSec)}
              unit={a('unitMin')}
              icon={Timer}
              tone="info"
            />
            <StatCard
              label={a('kpiWaste')}
              value={<span data-testid="kpi-waste">{hoursText(data.waste.totalSec, lang)}</span>}
              unit={a('unitHours')}
              icon={Hourglass}
              tone={data.waste.totalSec > 0 ? 'warning' : 'success'}
            />
            <StatCard
              label={a('kpiWasteShare')}
              value={
                data.wasteShare === null
                  ? '—'
                  : `${numText(Math.round(data.wasteShare * 100), lang, 0)}%`
              }
              icon={Percent}
              tone="warning"
            />
            <StatCard
              label={a('kpiLost')}
              value={<span data-testid="kpi-lost">{numText(data.lostServices, lang)}</span>}
              icon={Truck}
              tone="danger"
            />
            <StatCard
              label={t('operations.ui.analysis.kpiStopsShort')}
              value={numText(data.stopCount, lang, 0)}
              icon={TriangleAlert}
              tone="warning"
            />
            <StatCard
              label={a('kpiWithoutDriver')}
              value={numText(data.withoutDriver, lang, 0)}
              icon={UserX}
              tone={data.withoutDriver > 0 ? 'warning' : 'info'}
            />
            <StatCard
              label={t('operations.ui.analysis.kpiWastePerService')}
              value={data.services > 0 ? m(data.waste.totalSec / data.services) : '—'}
              unit={a('unitMin')}
              icon={Users}
              tone="info"
            />
          </div>

          <SegmentedControl
            aria-label={t('operations.ui.analysis.viewsLabel')}
            value={view}
            onChange={setView}
            className="self-start"
            options={VIEWS.map((value) => ({
              value,
              label: t(`operations.ui.analysis.views.${value}`),
            }))}
          />

          {view === 'overview' && (
            <Overview
              data={data}
              a={a}
              lang={lang}
              phaseName={phaseName}
              m={m}
              findingText={findingText}
            />
          )}
          {view === 'drivers' && (
            <Drivers data={data} a={a} lang={lang} phaseName={phaseName} m={m} />
          )}
          {view === 'vehicles' && (
            <Vehicles data={data} a={a} lang={lang} phaseName={phaseName} m={m} />
          )}
          {view === 'shifts' && (
            <ShiftsAndShovels data={data} a={a} lang={lang} m={m} shiftLabel={shiftLabel} />
          )}
          {view === 'stops' && <Stops data={data} a={a} lang={lang} m={m} />}
          {view === 'alerts' && (
            <>
              <Panel title={a('controlTitle')} testId="analysis-control">
                <ul className="list-disc space-y-1.5 ps-5 text-sm text-gray-700 dark:text-graydark-800">
                  {data.controlLimits.loadSec !== null && (
                    <li>{a('control.load', { value: minutesOf(data.controlLimits.loadSec) })}</li>
                  )}
                  {data.controlLimits.unloadSec !== null && (
                    <li>
                      {a('control.unload', { value: minutesOf(data.controlLimits.unloadSec) })}
                    </li>
                  )}
                  <li>{a('control.stop', { value: minutesOf(data.controlLimits.stopSec) })}</li>
                  <li>{a('control.review')}</li>
                  <li>{a('control.balance')}</li>
                </ul>
              </Panel>
              {routeId && <HaulLiveAlerts routeId={routeId} analysis={data} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

interface ViewProps {
  data: HaulAnalysisReport;
  a: (key: string, options?: Record<string, unknown>) => string;
  lang: string;
  m: (sec: number | null) => string;
}

function Overview({
  data,
  a,
  lang,
  phaseName,
  m,
  findingText,
}: ViewProps & {
  phaseName: (phase: AnalysisPhase) => string;
  findingText: (row: HaulAnalysisReport['findings'][number]) => string;
}) {
  const { t } = useTranslation();
  const wasteMin = PHASES.map((phase) => min(data.waste[`${phase}Sec` as const]));

  const phaseOptions = {
    colors: PHASE_COLORS,
    plotOptions: { bar: { distributed: true, borderRadius: 6, columnWidth: '42%' } },
    legend: { show: false },
    xaxis: { categories: PHASES.map((phase) => phaseName(phase)) },
    tooltip: { y: { formatter: (v: number) => `${numText(v, lang)} ${a('unitMin')}` } },
  } as ApexOptions;

  const budgetValues = BUDGET_KEYS.map((key) => data.timeBudget[`${key}Sec` as const] ?? 0);
  const budgetTotal = budgetValues.reduce((sum, v) => sum + v, 0);
  const budgetOptions = {
    labels: BUDGET_KEYS.map((key) => a(`budget.${key}`)),
    colors: BUDGET_COLORS,
    legend: { show: false },
    plotOptions: {
      pie: {
        donut: {
          labels: {
            total: {
              show: true,
              label: '',
              formatter: () => `${hoursText(budgetTotal, lang)} ${a('unitHours')}`,
            },
          },
        },
      },
    },
    tooltip: { y: { formatter: (v: number) => `${hoursText(v, lang)} ${a('unitHours')}` } },
  } as ApexOptions;

  const phaseColumns: Array<Column<AnalysisPhase>> = [
    {
      id: 'phase',
      headerKey: 'operations.analysis.colPhase',
      render: (phase) => phaseName(phase),
    },
    {
      id: 'samples',
      headerKey: 'operations.analysis.colSamples',
      render: (phase) => data.references[phase].samples,
    },
    {
      id: 'reference',
      header: `${a('colReference')} (${a('unitMin')})`,
      render: (phase) => {
        const ref = data.references[phase];
        return (
          <>
            {m(ref.referenceSec)}
            <span className="ms-1 text-xs text-gray-500">
              (
              {ref.source === 'CONFIGURED'
                ? a('sourceConfigured')
                : ref.source === 'FLEET'
                  ? a('sourceFleet')
                  : a('sourceNone')}
              )
            </span>
          </>
        );
      },
    },
    {
      id: 'median',
      header: `${a('colMedian')} (${a('unitMin')})`,
      render: (phase) => m(data.references[phase].medianSec),
    },
    {
      id: 'p75',
      header: `${a('colP75')} (${a('unitMin')})`,
      render: (phase) => m(data.references[phase].p75Sec),
    },
    {
      id: 'waste',
      headerKey: 'operations.analysis.colWasteMin',
      render: (phase) => m(data.waste[`${phase}Sec` as const]),
    },
    {
      id: 'share',
      headerKey: 'operations.analysis.colWasteShare',
      render: (phase) =>
        data.waste.totalSec > 0
          ? `${Math.round((data.waste[`${phase}Sec` as const] / data.waste.totalSec) * 100)}%`
          : '—',
    },
  ];

  return (
    <>
      <Panel title={a('findingsTitle')}>
        {data.findings.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-graydark-600">{a('noFindings')}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="analysis-findings">
            {data.findings.map((row, index) => (
              <li
                key={`${row.code}|${row.subjectId ?? ''}|${index}`}
                className="flex items-start gap-2.5 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-400"
              >
                <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                <span>{findingText(row)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartPanel
          title={t('operations.ui.analysis.chartPhases')}
          hint={a('phasesNote')}
          type="bar"
          series={[{ name: a('colWasteMin'), data: wasteMin }]}
          options={phaseOptions}
          height={360}
          empty={data.waste.totalSec === 0}
        />
        <ChartPanel
          title={t('operations.ui.analysis.chartBudget')}
          hint={a('budgetHint')}
          type="donut"
          series={budgetValues}
          options={budgetOptions}
          empty={budgetTotal === 0}
        >
          <div className="fv-scroll mt-3 overflow-x-auto" data-testid="analysis-budget">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {BUDGET_KEYS.map((key, index) => {
                  const sec = data.timeBudget[`${key}Sec` as const] ?? 0;
                  const share = budgetTotal > 0 ? sec / budgetTotal : 0;
                  return (
                    <tr key={key}>
                      <td className="py-2 pe-3">
                        <span className="flex items-center gap-2 text-gray-700 dark:text-graydark-800">
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: BUDGET_COLORS[index] }}
                          />
                          {a(`budget.${key}`)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2 text-end tabular-nums text-gray-600 dark:text-graydark-700">
                        {hoursText(sec, lang)} {a('unitHours')} · {Math.round(share * 100)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartPanel>
      </div>

      <Panel title={a('phasesTitle')}>
        <OpsTable
          testId="analysis-phases"
          columns={phaseColumns}
          rows={PHASES}
          rowKey={(phase) => phase}
        />
      </Panel>

      {data.openHauls.length > 0 && (
        <Panel title={a('openTitle')}>
          <ul className="flex flex-col gap-1.5 text-sm" data-testid="analysis-open">
            {data.openHauls.map((row) => (
              <li
                key={`${row.vehicleId}|${row.phase}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="font-medium">{row.vehicleName}</span>
                <Badge color="info">
                  {row.phase === 'LOADING' ? a('phaseLoading') : a('phaseHauling')}
                </Badge>
                <span className="text-gray-600 dark:text-graydark-700">
                  {m(row.elapsedSec)} {a('unitMin')}
                </span>
                {row.overdue && <Badge color="warning">{a('overdue')}</Badge>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Drivers({
  data,
  a,
  lang,
  m,
  phaseName,
}: ViewProps & { phaseName: (phase: AnalysisPhase) => string }) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => [...data.byDriver].sort((x, y) => y.wastePerServiceSec - x.wastePerServiceSec),
    [data.byDriver],
  );
  const phaseSeries = [
    { name: phaseName('load'), data: rows.map((r) => min(r.avgLoadSec)) },
    { name: phaseName('travel'), data: rows.map((r) => min(r.avgTravelSec)) },
    { name: phaseName('unload'), data: rows.map((r) => min(r.avgUnloadSec)) },
    { name: phaseName('return'), data: rows.map((r) => min(r.avgReturnSec)) },
  ];
  const categories = rows.map((r) => clip(r.driverName, 22));
  const stackedOptions = {
    colors: PHASE_COLORS,
    chart: { stacked: true },
    ...horizontalBar(categories),
    legend: { position: 'top', horizontalAlign: 'right' },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: (v: number) => `${numText(v, lang)} ${a('unitMin')}` },
    },
  } as ApexOptions;
  const wasteOptions = {
    colors: [apex.red],
    ...horizontalBar(categories),
    tooltip: { y: { formatter: (v: number) => `${numText(v, lang)} ${a('unitMin')}` } },
  } as ApexOptions;

  const columns: Array<Column<HaulAnalysisReport['byDriver'][number]>> = [
    { id: 'driver', headerKey: 'operations.colDriver', render: (r) => r.driverName },
    {
      id: 'vehicles',
      headerKey: 'operations.colVehicle',
      render: (r) => r.vehicleNames.join(', '),
    },
    {
      id: 'services',
      headerKey: 'operations.colServices',
      render: (r) => numText(r.services, lang, 0),
    },
    { id: 'load', headerKey: 'operations.analysis.colAvgLoad', render: (r) => m(r.avgLoadSec) },
    {
      id: 'unload',
      headerKey: 'operations.analysis.colAvgUnload',
      render: (r) => m(r.avgUnloadSec),
    },
    {
      id: 'travel',
      headerKey: 'operations.analysis.colAvgTravel',
      render: (r) => m(r.avgTravelSec),
    },
    {
      id: 'return',
      headerKey: 'operations.analysis.colAvgReturn',
      render: (r) => m(r.avgReturnSec),
    },
    {
      id: 'per',
      headerKey: 'operations.analysis.colWastePerService',
      render: (r) => m(r.wastePerServiceSec),
    },
    {
      id: 'total',
      headerKey: 'operations.analysis.colWasteTotal',
      render: (r) => m(r.waste.totalSec),
    },
    {
      id: 'stops',
      headerKey: 'operations.analysis.colStops',
      render: (r) => `${r.stopCount} · ${m(r.stopSec)}`,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartPanel
          title={t('operations.ui.analysis.chartDrivers')}
          type="bar"
          series={phaseSeries}
          options={stackedOptions}
          height={barsHeight(rows.length, 260)}
          empty={rows.length === 0}
        />
        <ChartPanel
          title={t('operations.ui.analysis.chartDriverWaste')}
          hint={a('driversHint')}
          type="bar"
          series={[
            { name: a('colWastePerService'), data: rows.map((r) => min(r.wastePerServiceSec)) },
          ]}
          options={wasteOptions}
          height={barsHeight(rows.length, 260)}
          empty={rows.length === 0}
        />
      </div>
      <Panel title={a('driversTitle')}>
        <OpsTable
          testId="analysis-drivers"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.driverId}
        />
      </Panel>
    </>
  );
}

function Vehicles({
  data,
  a,
  lang,
  m,
  phaseName,
}: ViewProps & { phaseName: (phase: AnalysisPhase) => string }) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => [...data.byVehicle].sort((x, y) => y.waste.totalSec - x.waste.totalSec),
    [data.byVehicle],
  );
  const categories = rows.map((r) => clip(r.vehicleName, 22));
  const series = PHASES.map((phase) => ({
    name: phaseName(phase),
    data: rows.map((r) => min(r.waste[`${phase}Sec` as const])),
  }));
  const options = {
    colors: PHASE_COLORS,
    chart: { stacked: true },
    ...horizontalBar(categories),
    legend: { position: 'top', horizontalAlign: 'right' },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: (v: number) => `${numText(v, lang)} ${a('unitMin')}` },
    },
  } as ApexOptions;

  const columns: Array<Column<HaulAnalysisReport['byVehicle'][number]>> = [
    { id: 'vehicle', headerKey: 'operations.colVehicle', render: (r) => r.vehicleName },
    {
      id: 'services',
      headerKey: 'operations.colServices',
      render: (r) => numText(r.services, lang, 0),
    },
    { id: 'cycle', headerKey: 'operations.analysis.colCycle', render: (r) => m(r.avgCycleSec) },
    { id: 'load', headerKey: 'operations.analysis.colAvgLoad', render: (r) => m(r.avgLoadSec) },
    {
      id: 'unload',
      headerKey: 'operations.analysis.colAvgUnload',
      render: (r) => m(r.avgUnloadSec),
    },
    {
      id: 'waste',
      headerKey: 'operations.analysis.colWasteTotal',
      render: (r) => m(r.waste.totalSec),
    },
    {
      id: 'idle',
      headerKey: 'operations.analysis.colIdleOutside',
      render: (r) => m(r.timeBudget.idleOutsideSec),
    },
    {
      id: 'parked',
      headerKey: 'operations.analysis.colParked',
      render: (r) => m(r.timeBudget.parkedSec),
    },
    {
      id: 'nodata',
      headerKey: 'operations.analysis.colNoData',
      render: (r) => m(r.timeBudget.noDataSec),
    },
  ];

  return (
    <>
      <ChartPanel
        title={t('operations.ui.analysis.chartVehicles')}
        type="bar"
        series={series}
        options={options}
        height={barsHeight(rows.length, 260)}
        empty={rows.length === 0 || data.waste.totalSec === 0}
      />
      <Panel title={a('vehiclesTitle')}>
        <OpsTable
          testId="analysis-vehicles"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.vehicleId}
        />
      </Panel>
    </>
  );
}

function ShiftsAndShovels({
  data,
  a,
  lang,
  m,
  shiftLabel,
}: ViewProps & {
  shiftLabel: (row: { shift: string; shiftDate: string | null; shiftNo: number }) => string;
}) {
  const { t } = useTranslation();
  const shifts = data.byShift;
  const shovels = data.byShovel;

  const shiftOptions = {
    colors: [apex.red],
    xaxis: {
      categories: shifts.map((row) => shiftLabel(row)),
      labels: { trim: true, hideOverlappingLabels: true },
    },
    tooltip: { y: { formatter: (v: number) => `${numText(v, lang)} ${a('unitMin')}` } },
  } as ApexOptions;
  const shovelOptions = {
    colors: [apex.orange, apex.slate],
    xaxis: { categories: shovels.map((row) => clip(row.shovelLabel, 16)) },
    legend: { position: 'top', horizontalAlign: 'right' },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: (v: number) => `${numText(v, lang)} ${a('unitMin')}` },
    },
  } as ApexOptions;

  const shiftColumns: Array<Column<HaulAnalysisReport['byShift'][number]>> = [
    { id: 'shift', headerKey: 'operations.colShift', render: (r) => shiftLabel(r) },
    {
      id: 'services',
      headerKey: 'operations.colServices',
      render: (r) => numText(r.services, lang, 0),
    },
    { id: 'cycle', headerKey: 'operations.analysis.colCycle', render: (r) => m(r.avgCycleSec) },
    {
      id: 'waste',
      headerKey: 'operations.analysis.colWasteTotal',
      render: (r) => m(r.waste.totalSec),
    },
  ];
  const shovelColumns: Array<Column<HaulAnalysisReport['byShovel'][number]>> = [
    { id: 'shovel', headerKey: 'operations.colShovel', render: (r) => r.shovelLabel },
    { id: 'loads', headerKey: 'operations.loads', render: (r) => numText(r.loads, lang, 0) },
    { id: 'queue', headerKey: 'operations.analysis.colQueue', render: (r) => m(r.truckQueueSec) },
    {
      id: 'idle',
      headerKey: 'operations.analysis.colShovelIdle',
      render: (r) => m(r.shovelIdleSec),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartPanel
          title={t('operations.ui.analysis.chartShifts')}
          type="bar"
          series={[
            { name: a('colWasteTotal'), data: shifts.map((row) => min(row.waste.totalSec)) },
          ]}
          options={shiftOptions}
          empty={shifts.length === 0}
        />
        <ChartPanel
          title={t('operations.ui.analysis.chartShovels')}
          hint={a('shovelsHint')}
          type="bar"
          series={[
            { name: a('colQueue'), data: shovels.map((row) => min(row.truckQueueSec)) },
            { name: a('colShovelIdle'), data: shovels.map((row) => min(row.shovelIdleSec)) },
          ]}
          options={shovelOptions}
          empty={shovels.length === 0}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={a('shiftsTitle')}>
          <OpsTable
            testId="analysis-shifts"
            columns={shiftColumns}
            rows={shifts}
            rowKey={(r) => r.shift}
          />
        </Panel>
        <Panel title={a('shovelsTitle')}>
          <OpsTable
            testId="analysis-shovels"
            columns={shovelColumns}
            rows={shovels}
            rowKey={(r) => r.shovelId}
          />
        </Panel>
      </div>
    </>
  );
}

function Stops({ data, a, lang, m }: ViewProps) {
  const columns: Array<Column<HaulAnalysisReport['stops'][number]>> = [
    { id: 'vehicle', headerKey: 'operations.colVehicle', render: (r) => r.vehicleName },
    { id: 'driver', headerKey: 'operations.colDriver', render: (r) => r.driverName ?? '—' },
    ...startEndColumns(
      (r: HaulAnalysisReport['stops'][number]) => r.startedAt,
      (r) => r.endedAt,
      lang,
    ),
    {
      id: 'duration',
      headerKey: 'operations.analysis.colDuration',
      render: (r) => m(r.durationSec),
    },
    {
      id: 'category',
      headerKey: 'operations.analysis.colCategory',
      render: (r) => {
        const category = r.category ?? 'OPERATIONAL';
        return (
          <Badge
            color={category === 'LUNCH' ? 'info' : category === 'HANDOVER' ? 'warning' : 'gray'}
          >
            {a(
              category === 'LUNCH' ? 'lunch' : category === 'HANDOVER' ? 'handover' : 'operational',
            )}
          </Badge>
        );
      },
    },
    {
      id: 'engine',
      headerKey: 'operations.analysis.colEngine',
      render: (r) => (
        <Badge color={r.engineOn ? 'warning' : 'gray'} dot>
          {r.engineOn ? a('engineOn') : a('engineOff')}
        </Badge>
      ),
    },
    {
      id: 'leg',
      headerKey: 'operations.analysis.colLeg',
      render: (r) => (r.phase === 'LOADED' ? a('legLoaded') : a('legEmpty')),
    },
    {
      id: 'location',
      headerKey: 'operations.analysis.colLocation',
      render: (r) => `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`,
    },
  ];
  const planned = data.plannedStops;
  return (
    <Panel
      title={a('stopsTitle')}
      hint={`${a('stopsHint')} (${m(data.stopMinSec)} ${a('unitMin')})`}
    >
      {planned && (
        <div
          className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm"
          data-testid="analysis-planned-stops"
        >
          <span className="font-medium text-gray-700 dark:text-graydark-800">
            {a('categoryTitle')}
          </span>
          <span className="tabular-nums text-gray-600 dark:text-graydark-700">
            {a('operational')}: {numText(data.stopCount, lang, 0)} · {m(data.stopSec)}{' '}
            {a('unitMin')}
          </span>
          <span className="tabular-nums text-gray-600 dark:text-graydark-700">
            {a('lunch')}: {numText(planned.lunchCount, lang, 0)} · {m(planned.lunchSec)}{' '}
            {a('unitMin')}
          </span>
          <span className="tabular-nums text-gray-600 dark:text-graydark-700">
            {a('handover')}: {numText(planned.handoverCount, lang, 0)} · {m(planned.handoverSec)}{' '}
            {a('unitMin')}
          </span>
          <span className="w-full text-xs text-gray-500 dark:text-graydark-600">
            {a('categoryHint')}
          </span>
        </div>
      )}
      {data.stops.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-graydark-600">{a('noStops')}</p>
      ) : (
        <OpsTable
          testId="analysis-stops"
          columns={columns}
          rows={data.stops}
          rowKey={(r) => `${r.vehicleId}|${r.startedAt}`}
        />
      )}
    </Panel>
  );
}

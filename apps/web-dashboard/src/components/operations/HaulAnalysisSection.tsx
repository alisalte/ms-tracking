/**
 * Wasted-time analysis of a haul route (`/operations`).
 *
 * Splits every service into loading, loaded haul, unloading and empty return,
 * measures each against a reference (the fleet's own best quartile, or a
 * target the operator types), and shows who and what loses the time: drivers,
 * trucks, shifts, shovels and long stops outside the origin and destination.
 */
import { Download } from 'lucide-react';
import { useState } from 'react';
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
import { Button } from '@/components/tailwind-ui';
import { formatWorkDay, hoursOf, minutesOf } from '@/lib/operations-export';

const PHASES: AnalysisPhase[] = ['load', 'travel', 'unload', 'return'];
const TARGET_FIELDS: Array<{ key: keyof AnalysisTargets; label: string }> = [
  { key: 'targetLoadMin', label: 'targetLoad' },
  { key: 'targetTravelMin', label: 'targetTravel' },
  { key: 'targetUnloadMin', label: 'targetUnload' },
  { key: 'targetReturnMin', label: 'targetReturn' },
  { key: 'stopMin', label: 'targetStop' },
];
const BUDGET_KEYS = ['origin', 'destination', 'moving', 'idleOutside', 'parked', 'noData'] as const;
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

function mins(sec: number | null): string {
  const value = minutesOf(sec);
  return value === null ? '—' : String(value);
}

function stamp(value: string, lang: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB');
}

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

  return (
    <section
      className="rounded-xl border border-stone-200 bg-white p-4"
      data-testid="haul-analysis"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{a('title')}</h2>
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
      </div>
      <p className="mt-1 text-sm text-slate-600">{a('hint')}</p>
      {!routeId && <p className="mt-3 text-sm text-slate-600">{a('pickRoute')}</p>}
      {report.isError && (
        <p className="mt-3 text-sm text-red-700">{getApiErrorMessage(report.error)}</p>
      )}
      {data?.truncated && (
        <p className="mt-3 text-sm text-amber-800">{t('operations.truncated')}</p>
      )}

      {routeId && (
        <form
          className="mt-3 rounded-lg border border-slate-200 p-3"
          data-testid="analysis-targets"
          onSubmit={(event) => {
            event.preventDefault();
            setTargets(draft);
          }}
        >
          <h3 className="text-sm font-semibold">{a('targetsTitle')}</h3>
          <p className="mt-1 text-xs text-slate-500">{a('targetsHint')}</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            {TARGET_FIELDS.map(({ key, label }) => (
              <label key={key} className="text-xs font-medium">
                {a(label)}
                <input
                  type="number"
                  min={1}
                  max={1440}
                  step="any"
                  inputMode="decimal"
                  placeholder={a('auto')}
                  data-testid={`analysis-${key}`}
                  className="mt-1 block w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  value={draft[key] ?? ''}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
                />
              </label>
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
      )}

      {data && (
        <div className="mt-4 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="analysis-kpis">
            <Kpi label={a('kpiServices')} value={String(data.services)} testId="kpi-services" />
            <Kpi
              label={a('kpiMedianCycle')}
              value={`${mins(data.cycleMedianSec)} ${a('unitMin')}`}
            />
            <Kpi
              label={a('kpiWaste')}
              value={`${hoursOf(data.waste.totalSec)} ${a('unitHours')}`}
              tone={data.waste.totalSec > 0 ? 'warn' : undefined}
              testId="kpi-waste"
            />
            <Kpi
              label={a('kpiWasteShare')}
              value={data.wasteShare === null ? '—' : `${Math.round(data.wasteShare * 100)}%`}
            />
            <Kpi
              label={a('kpiLost')}
              value={data.lostServices === null ? '—' : String(data.lostServices)}
              testId="kpi-lost"
            />
            <Kpi label={a('kpiStops')} value={`${data.stopCount}`} />
            <Kpi
              label={a('kpiWithoutDriver')}
              value={String(data.withoutDriver)}
              tone={data.withoutDriver > 0 ? 'warn' : undefined}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold">{a('findingsTitle')}</h3>
            {data.findings.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">{a('noFindings')}</p>
            ) : (
              <ul className="mt-2 list-disc space-y-1 ps-5 text-sm" data-testid="analysis-findings">
                {data.findings.map((row, index) => (
                  <li key={`${row.code}|${row.subjectId ?? ''}|${index}`}>{findingText(row)}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-x-auto">
            <h3 className="text-sm font-semibold">{a('phasesTitle')}</h3>
            <table className="mt-2 w-full text-sm" data-testid="analysis-phases">
              <thead className="text-start text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">{a('colPhase')}</th>
                  <th className="px-2 py-2 font-medium">{a('colSamples')}</th>
                  <th className="px-2 py-2 font-medium">
                    {a('colReference')} ({a('unitMin')})
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {a('colMedian')} ({a('unitMin')})
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {a('colP75')} ({a('unitMin')})
                  </th>
                  <th className="px-2 py-2 font-medium">{a('colWasteMin')}</th>
                  <th className="px-2 py-2 font-medium">{a('colWasteShare')}</th>
                </tr>
              </thead>
              <tbody>
                {PHASES.map((phase) => {
                  const ref = data.references[phase];
                  const wasted = data.waste[`${phase}Sec` as const];
                  return (
                    <tr key={phase} className="border-t border-slate-100">
                      <td className="px-2 py-2">{a(`phase.${phase}`)}</td>
                      <td className="px-2 py-2">{ref.samples}</td>
                      <td className="px-2 py-2">
                        {mins(ref.referenceSec)}
                        <span className="ms-1 text-xs text-slate-500">
                          (
                          {ref.source === 'CONFIGURED'
                            ? a('sourceConfigured')
                            : ref.source === 'FLEET'
                              ? a('sourceFleet')
                              : a('sourceNone')}
                          )
                        </span>
                      </td>
                      <td className="px-2 py-2">{mins(ref.medianSec)}</td>
                      <td className="px-2 py-2">{mins(ref.p75Sec)}</td>
                      <td className="px-2 py-2 font-medium">{mins(wasted)}</td>
                      <td className="px-2 py-2">
                        {data.waste.totalSec > 0
                          ? `${Math.round((wasted / data.waste.totalSec) * 100)}%`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-500">{a('phasesNote')}</p>
          </div>

          <BudgetBars budget={data.timeBudget} a={a} />

          <div className="overflow-x-auto">
            <h3 className="text-sm font-semibold">{a('driversTitle')}</h3>
            <p className="mt-1 text-xs text-slate-500">{a('driversHint')}</p>
            <table className="mt-2 w-full text-sm" data-testid="analysis-drivers">
              <thead className="text-start text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">{t('operations.colDriver')}</th>
                  <th className="px-2 py-2 font-medium">{t('operations.colVehicle')}</th>
                  <th className="px-2 py-2 font-medium">{t('operations.colServices')}</th>
                  <th className="px-2 py-2 font-medium">{a('colAvgLoad')}</th>
                  <th className="px-2 py-2 font-medium">{a('colAvgUnload')}</th>
                  <th className="px-2 py-2 font-medium">{a('colAvgTravel')}</th>
                  <th className="px-2 py-2 font-medium">{a('colAvgReturn')}</th>
                  <th className="px-2 py-2 font-medium">{a('colWastePerService')}</th>
                  <th className="px-2 py-2 font-medium">{a('colWasteTotal')}</th>
                  <th className="px-2 py-2 font-medium">{a('colStops')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byDriver.map((row) => (
                  <tr key={row.driverId} className="border-t border-slate-100">
                    <td className="px-2 py-2">{row.driverName}</td>
                    <td className="px-2 py-2">{row.vehicleNames.join(', ')}</td>
                    <td className="px-2 py-2">{row.services}</td>
                    <td className="px-2 py-2">{mins(row.avgLoadSec)}</td>
                    <td className="px-2 py-2">{mins(row.avgUnloadSec)}</td>
                    <td className="px-2 py-2">{mins(row.avgTravelSec)}</td>
                    <td className="px-2 py-2">{mins(row.avgReturnSec)}</td>
                    <td className="px-2 py-2 font-medium">{mins(row.wastePerServiceSec)}</td>
                    <td className="px-2 py-2">{mins(row.waste.totalSec)}</td>
                    <td className="px-2 py-2">
                      {row.stopCount} · {mins(row.stopSec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <h3 className="text-sm font-semibold">{a('vehiclesTitle')}</h3>
            <table className="mt-2 w-full text-sm" data-testid="analysis-vehicles">
              <thead className="text-start text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">{t('operations.colVehicle')}</th>
                  <th className="px-2 py-2 font-medium">{t('operations.colServices')}</th>
                  <th className="px-2 py-2 font-medium">{a('colCycle')}</th>
                  <th className="px-2 py-2 font-medium">{a('colAvgLoad')}</th>
                  <th className="px-2 py-2 font-medium">{a('colAvgUnload')}</th>
                  <th className="px-2 py-2 font-medium">{a('colWasteTotal')}</th>
                  <th className="px-2 py-2 font-medium">{a('colIdleOutside')}</th>
                  <th className="px-2 py-2 font-medium">{a('colParked')}</th>
                  <th className="px-2 py-2 font-medium">{a('colNoData')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byVehicle.map((row) => (
                  <tr key={row.vehicleId} className="border-t border-slate-100">
                    <td className="px-2 py-2">{row.vehicleName}</td>
                    <td className="px-2 py-2">{row.services}</td>
                    <td className="px-2 py-2">{mins(row.avgCycleSec)}</td>
                    <td className="px-2 py-2">{mins(row.avgLoadSec)}</td>
                    <td className="px-2 py-2">{mins(row.avgUnloadSec)}</td>
                    <td className="px-2 py-2 font-medium">{mins(row.waste.totalSec)}</td>
                    <td className="px-2 py-2">{mins(row.timeBudget.idleOutsideSec)}</td>
                    <td className="px-2 py-2">{mins(row.timeBudget.parkedSec)}</td>
                    <td className="px-2 py-2">{mins(row.timeBudget.noDataSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <h3 className="text-sm font-semibold">{a('shiftsTitle')}</h3>
              <table className="mt-2 w-full text-sm" data-testid="analysis-shifts">
                <thead className="text-start text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t('operations.colShift')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colServices')}</th>
                    <th className="px-2 py-2 font-medium">{a('colCycle')}</th>
                    <th className="px-2 py-2 font-medium">{a('colWasteTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byShift.map((row) => (
                    <tr key={row.shift} className="border-t border-slate-100">
                      <td className="px-2 py-2">{shiftLabel(row)}</td>
                      <td className="px-2 py-2">{row.services}</td>
                      <td className="px-2 py-2">{mins(row.avgCycleSec)}</td>
                      <td className="px-2 py-2 font-medium">{mins(row.waste.totalSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <h3 className="text-sm font-semibold">{a('shovelsTitle')}</h3>
              <p className="mt-1 text-xs text-slate-500">{a('shovelsHint')}</p>
              <table className="mt-2 w-full text-sm" data-testid="analysis-shovels">
                <thead className="text-start text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t('operations.colShovel')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.loads')}</th>
                    <th className="px-2 py-2 font-medium">{a('colQueue')}</th>
                    <th className="px-2 py-2 font-medium">{a('colShovelIdle')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byShovel.map((row) => (
                    <tr key={row.shovelId} className="border-t border-slate-100">
                      <td className="px-2 py-2">{row.shovelLabel}</td>
                      <td className="px-2 py-2">{row.loads}</td>
                      <td className="px-2 py-2">{mins(row.truckQueueSec)}</td>
                      <td className="px-2 py-2">{mins(row.shovelIdleSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-x-auto">
            <h3 className="text-sm font-semibold">{a('stopsTitle')}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {a('stopsHint')} ({mins(data.stopMinSec)} {a('unitMin')})
            </p>
            {data.stops.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">{a('noStops')}</p>
            ) : (
              <table className="mt-2 w-full text-sm" data-testid="analysis-stops">
                <thead className="text-start text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t('operations.colVehicle')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colDriver')}</th>
                    <th className="px-2 py-2 font-medium">{a('colStart')}</th>
                    <th className="px-2 py-2 font-medium">{a('colDuration')}</th>
                    <th className="px-2 py-2 font-medium">{a('colEngine')}</th>
                    <th className="px-2 py-2 font-medium">{a('colLeg')}</th>
                    <th className="px-2 py-2 font-medium">{a('colLocation')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stops.map((row) => (
                    <tr
                      key={`${row.vehicleId}|${row.startedAt}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-2 py-2">{row.vehicleName}</td>
                      <td className="px-2 py-2">{row.driverName ?? '—'}</td>
                      <td className="px-2 py-2">{stamp(row.startedAt, lang)}</td>
                      <td className="px-2 py-2 font-medium">{mins(row.durationSec)}</td>
                      <td className="px-2 py-2">{row.engineOn ? a('engineOn') : a('engineOff')}</td>
                      <td className="px-2 py-2">
                        {row.phase === 'LOADED' ? a('legLoaded') : a('legEmpty')}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">
                        {row.lat.toFixed(5)}, {row.lng.toFixed(5)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {data.openHauls.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">{a('openTitle')}</h3>
              <ul className="mt-2 space-y-1 text-sm" data-testid="analysis-open">
                {data.openHauls.map((row) => (
                  <li key={`${row.vehicleId}|${row.phase}`}>
                    {row.vehicleName} ·{' '}
                    {row.phase === 'LOADING' ? a('phaseLoading') : a('phaseHauling')} ·{' '}
                    {mins(row.elapsedSec)} {a('unitMin')}
                    {row.overdue && <span className="ms-2 text-amber-800">{a('overdue')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg bg-slate-50 p-3" data-testid="analysis-control">
            <h3 className="text-sm font-semibold">{a('controlTitle')}</h3>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-slate-700">
              {data.controlLimits.loadSec !== null && (
                <li>{a('control.load', { value: minutesOf(data.controlLimits.loadSec) })}</li>
              )}
              {data.controlLimits.unloadSec !== null && (
                <li>{a('control.unload', { value: minutesOf(data.controlLimits.unloadSec) })}</li>
              )}
              <li>{a('control.stop', { value: minutesOf(data.controlLimits.stopSec) })}</li>
              <li>{a('control.review')}</li>
              <li>{a('control.balance')}</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function Kpi({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: 'warn';
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold ${tone === 'warn' ? 'text-amber-800' : ''}`}
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}

function BudgetBars({
  budget,
  a,
}: {
  budget: HaulAnalysisReport['timeBudget'];
  a: (key: string) => string;
}) {
  const total = BUDGET_KEYS.reduce((sum, key) => sum + budget[`${key}Sec` as const], 0);
  return (
    <div>
      <h3 className="text-sm font-semibold">{a('budgetTitle')}</h3>
      <p className="mt-1 text-xs text-slate-500">{a('budgetHint')}</p>
      <table className="mt-2 w-full text-sm" data-testid="analysis-budget">
        <tbody>
          {BUDGET_KEYS.map((key) => {
            const sec = budget[`${key}Sec` as const];
            const share = total > 0 ? sec / total : 0;
            return (
              <tr key={key} className="border-t border-slate-100">
                <td className="w-1/2 px-2 py-2">{a(`budget.${key}`)}</td>
                <td className="px-2 py-2">
                  <div className="h-2 rounded bg-slate-100">
                    <div
                      className="h-2 rounded bg-slate-500"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </div>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-end">
                  {hoursOf(sec)} {a('unitHours')} · {Math.round(share * 100)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

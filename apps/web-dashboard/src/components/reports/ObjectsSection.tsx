/**
 * ObjectsSection — "Objects" (لیست متحرک‌ها): every vehicle with its tracker
 * (IMEI, model, SIM), fleet, newest stored fix (position, speed, altitude,
 * heading, odometer) and when the device sent it / the server received it —
 * the previous system's objects list, refreshed every minute. Exports as CSV in
 * the legacy column order, or as Excel.
 */
import { FileText, Radio, Satellite, Timer, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type FleetScope,
  type ObjectStatusRowWire,
  exportFleetWorkbook,
  exportObjectsCsv,
  useObjectsReport,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { FleetReportToolbar } from '@/components/reports/FleetReportKit';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Skeleton } from '@/components/tailwind-ui';
import { formatClock, formatDateNumeric } from '@/lib/format-date';

const DAY_MS = 86_400_000;

export function ObjectsSection() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'fa';
  const [scope, setScope] = useState<FleetScope>({});
  const [search, setSearch] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const q = useObjectsReport(scope);
  const data = q.data;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const items = data?.items ?? [];
    if (!needle) return items;
    return items.filter((r) =>
      [r.name, r.imei, r.plate, r.simNumber, r.fleetName, r.model]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [data, search]);

  const stamp = (iso: string | null) =>
    iso ? `${formatDateNumeric(iso, i18n.language)} ${formatClock(iso, i18n.language)}` : '—';
  const n = (v: number | null, digits = 0) => (v === null ? '—' : v.toFixed(digits));

  const columns: Column<ObjectStatusRowWire>[] = [
    { id: 'name', headerKey: 'reports.objects.name', render: (r) => r.name },
    { id: 'imei', header: 'IMEI', render: (r) => <span dir="ltr">{r.imei ?? '—'}</span> },
    { id: 'fleet', headerKey: 'reports.objects.group', render: (r) => r.fleetName ?? '—' },
    { id: 'model', headerKey: 'reports.objects.model', render: (r) => r.model ?? '—' },
    {
      id: 'sim',
      headerKey: 'reports.objects.sim',
      render: (r) => <span dir="ltr">{r.simNumber ?? '—'}</span>,
    },
    {
      id: 'active',
      headerKey: 'reports.objects.active',
      render: (r) => t(r.active ? 'reports.objects.yes' : 'reports.objects.no'),
    },
    {
      id: 'position',
      headerKey: 'reports.objects.position',
      render: (r) =>
        r.lat === null || r.lng === null ? (
          '—'
        ) : (
          <span dir="ltr" className="whitespace-nowrap">
            {r.lat.toFixed(6)}, {r.lng.toFixed(6)}
          </span>
        ),
    },
    { id: 'speed', headerKey: 'reports.objects.speed', render: (r) => n(r.speedKmh) },
    { id: 'alt', headerKey: 'reports.objects.altitude', render: (r) => n(r.altitudeM) },
    { id: 'angle', headerKey: 'reports.objects.angle', render: (r) => n(r.headingDeg) },
    { id: 'odo', headerKey: 'reports.objects.odometer', render: (r) => n(r.odometerKm, 1) },
    {
      id: 'lastFix',
      headerKey: 'reports.objects.lastDevice',
      render: (r) => <LastSeen iso={r.lastFixAt} text={stamp(r.lastFixAt)} />,
    },
    {
      id: 'lastServer',
      headerKey: 'reports.objects.lastServer',
      render: (r) => <span className="whitespace-nowrap">{stamp(r.lastReceivedAt)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="report-objects">
      <FleetReportToolbar
        testid="objects-toolbar"
        scope={scope}
        onScope={setScope}
        onExport={() => exportFleetWorkbook('objects', {}, { ...scope }, lang)}
      >
        <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-graydark-700">
          {t('reports.objects.search')}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('reports.objects.searchHint')}
            className="h-9 min-w-56 rounded-lg border border-gray-300 bg-transparent px-2 text-sm dark:border-white/10"
          />
        </label>
        <button
          type="button"
          disabled={csvBusy}
          onClick={async () => {
            setCsvBusy(true);
            try {
              await exportObjectsCsv(scope, lang);
            } finally {
              setCsvBusy(false);
            }
          }}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 self-end rounded-lg border border-gray-300 px-3 text-sm font-semibold disabled:opacity-50 dark:border-white/10"
        >
          <FileText size={14} aria-hidden="true" />
          {t('reports.objects.exportCsv')}
        </button>
      </FleetReportToolbar>

      {q.isLoading ? (
        // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
        <div className="flex flex-col gap-3" role="status">
          <Skeleton className="h-[104px] rounded-2xl" />
          <Skeleton className="h-[320px] rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile
              labelKey="reports.objects.total"
              value={data.summary.total}
              icon={Truck}
              tone="brand"
            />
            <KpiTile
              labelKey="reports.objects.online"
              value={data.summary.online}
              icon={Radio}
              tone="success"
            />
            <KpiTile
              labelKey="reports.objects.silent24h"
              value={data.summary.silent24h}
              icon={Timer}
              tone="warning"
            />
            <KpiTile
              labelKey="reports.objects.noFix"
              value={data.summary.noFix}
              icon={Satellite}
              tone="gray"
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-graydark-600">
            {t('reports.objects.asOf', { time: stamp(data.asOf) })} ·{' '}
            {t('reports.objects.shown', { count: rows.length, total: data.items.length })}
          </p>
          <ReportsTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.vehicleId}
            emptyKey="reports.empty"
            dense
          />
        </>
      ) : null}
    </div>
  );
}

/** Last device time, highlighted when the tracker has been silent for a day or more. */
function LastSeen({ iso, text }: { iso: string | null; text: string }) {
  const stale = iso !== null && Date.now() - Date.parse(iso) > DAY_MS;
  return (
    <span
      className={`whitespace-nowrap ${stale ? 'font-semibold text-warning-600 dark:text-warning-400' : ''}`}
    >
      {text}
    </span>
  );
}

/**
 * MileageSection — "Mileage" (مسافت پیموده‌شده): kilometres per vehicle over
 * the period, grouped by fleet with a subtotal per fleet and a grand total.
 * Source: the GPS engine's completed trips (same as the distance report).
 */
import { Route, Truck } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type FleetScope,
  type ReportRange,
  exportFleetWorkbook,
  useMileageReport,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { FleetReportToolbar } from '@/components/reports/FleetReportKit';
import { Card, Skeleton, TBody, TD, TH, THead, Table } from '@/components/tailwind-ui';
import { formatClock, formatDateNumeric } from '@/lib/format-date';

export function MileageSection({ range }: { range: ReportRange }) {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<FleetScope>({});
  const [hideZero, setHideZero] = useState(false);
  const q = useMileageReport(range, scope, hideZero);
  const data = q.data;
  const km = (n: number) =>
    `${n.toLocaleString(i18n.language === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 2 })} ${t('reports.fleet.km')}`;
  const stamp = (iso: string) =>
    `${formatDateNumeric(iso, i18n.language)} ${formatClock(iso, i18n.language)}`;

  let n = 0;
  return (
    <div className="flex flex-col gap-4" data-testid="report-mileage">
      <FleetReportToolbar
        testid="mileage-toolbar"
        scope={scope}
        onScope={setScope}
        onExport={() =>
          exportFleetWorkbook(
            'mileage',
            range,
            { ...scope, hideZero },
            i18n.language === 'en' ? 'en' : 'fa',
          )
        }
      >
        <label className="flex h-9 items-center gap-2 text-xs text-gray-600 dark:text-graydark-700">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
          />
          {t('reports.fleet.hideZero')}
        </label>
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <KpiTile
              labelKey="reports.fleet.totalKm"
              value={Math.round(data.totalKm * 10) / 10}
              suffix=" km"
              icon={Route}
              tone="brand"
            />
            <KpiTile
              labelKey="reports.fleet.vehicleCount"
              value={data.vehicleCount}
              icon={Truck}
              tone="info"
            />
            <KpiTile
              labelKey="reports.fleet.avgPerVehicle"
              value={
                data.vehicleCount > 0
                  ? Math.round((data.totalKm / data.vehicleCount) * 10) / 10
                  : null
              }
              suffix=" km"
              icon={Route}
              tone="teal"
            />
          </div>
          {data.hiddenZeroCount > 0 && (
            <p className="text-xs text-gray-500 dark:text-graydark-600">
              {t('reports.fleet.hiddenZero', { count: data.hiddenZeroCount })}
            </p>
          )}
          {data.vehicleCount === 0 ? (
            <Card>
              <p className="py-10 text-center text-sm text-gray-500">{t('reports.empty')}</p>
            </Card>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>#</TH>
                  <TH>{t('reports.fleet.vehicleName')}</TH>
                  <TH>{t('reports.fleet.from')}</TH>
                  <TH>{t('reports.fleet.to')}</TH>
                  <TH>{t('reports.cols.distance')}</TH>
                  <TH>{t('reports.cols.trips')}</TH>
                </tr>
              </THead>
              <TBody>
                {data.groups.map((g) => (
                  <Fragment key={g.fleetId ?? 'none'}>
                    {data.groups.length > 1 && (
                      <tr className="bg-gray-50 dark:bg-white/5">
                        <TD colSpan={6} className="py-2 text-xs font-semibold">
                          {g.fleetName ?? t('reports.fleet.noFleet')}
                        </TD>
                      </tr>
                    )}
                    {g.rows.map((r) => {
                      n += 1;
                      return (
                        <tr key={r.vehicleId}>
                          <TD className="py-2">{n}</TD>
                          <TD className="py-2">{r.label}</TD>
                          <TD className="py-2 whitespace-nowrap">{stamp(data.from)}</TD>
                          <TD className="py-2 whitespace-nowrap">{stamp(data.to)}</TD>
                          <TD className="py-2 whitespace-nowrap">{km(r.distanceKm)}</TD>
                          <TD className="py-2">{r.trips}</TD>
                        </tr>
                      );
                    })}
                    {data.groups.length > 1 && (
                      <tr>
                        <TD colSpan={4} className="py-2 text-end text-xs font-semibold">
                          {t('reports.fleet.subtotal')}
                        </TD>
                        <TD className="py-2 font-semibold whitespace-nowrap">{km(g.subtotalKm)}</TD>
                        <TD />
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className="bg-brand-50/60 dark:bg-brand-500/10">
                  <TD colSpan={4} className="py-2 text-end font-semibold">
                    {t('reports.fleet.grandTotal')}
                  </TD>
                  <TD className="py-2 font-bold whitespace-nowrap">{km(data.totalKm)}</TD>
                  <TD />
                </tr>
              </TBody>
            </Table>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * Haul services tab: the services of one route in the chosen range, seen by
 * shift, machine, driver, shovel or one by one.
 *
 * A service is one origin → destination pass of a truck, with the driver of
 * that shift and the shovel that was loading it.
 */
import type { ApexOptions } from 'apexcharts';
import { Download, Gauge, Route, Timer, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { HaulCycleReport } from '@/api/operations.api';
import { StatCard } from '@/components/analytics/StatCard';
import {
  ChartPanel,
  OpsTable,
  Panel,
  barsHeight,
  clip,
  comboChart,
  horizontalBar,
  hoursText,
  numText,
  round,
  stampText,
} from '@/components/operations/ops-ui';
import type { Column } from '@/components/reports/ReportsTable';
import { Alert, Badge, Button, SegmentedControl, Skeleton } from '@/components/tailwind-ui';
import { formatWorkDay } from '@/lib/operations-export';
import { chart } from '@/theme/palette';

type View = 'shift' | 'vehicle' | 'driver' | 'shovel' | 'list';
const VIEWS: View[] = ['shift', 'vehicle', 'driver', 'shovel', 'list'];

export function ServicesTab({
  data,
  loading,
  exporting,
  onExport,
}: {
  data: HaulCycleReport | undefined;
  loading: boolean;
  exporting: boolean;
  onExport: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [view, setView] = useState<View>('shift');

  const shiftLabel = (row: { shift: string; shiftDate: string | null; shiftNo: number }) =>
    row.shift === 'off-shift' || !row.shiftDate
      ? t('operations.offShift')
      : `${formatWorkDay(row.shiftDate, lang)} · ${t('operations.shiftN', { n: row.shiftNo })}`;

  const totalSec = (data?.byVehicle ?? []).reduce((sum, row) => sum + row.durationSec, 0);
  const trucks = data?.byVehicle.length ?? 0;

  const shifts = data?.byShift ?? [];
  const shiftChart = comboChart(
    shifts.map((row) => shiftLabel(row)),
    {
      name: t('operations.services'),
      data: shifts.map((row) => row.services),
    },
    {
      name: t('operations.colDistance'),
      data: shifts.map((row) => round(row.distanceKm)),
      unit: t('operations.ui.unitKm'),
    },
    lang,
  );

  const vehicles = useMemo(
    () => [...(data?.byVehicle ?? [])].sort((a, b) => b.services - a.services),
    [data],
  );
  const driverRows = useMemo(
    () => [...(data?.byDriverShift ?? [])].sort((a, b) => b.services - a.services),
    [data],
  );
  const shovels = useMemo(
    () => [...(data?.byShovel ?? [])].sort((a, b) => b.loads - a.loads),
    [data],
  );

  const barOptions = (categories: string[], color: string): ApexOptions => ({
    colors: [color],
    ...horizontalBar(categories),
  });

  const shiftColumns: Array<Column<HaulCycleReport['byShift'][number]>> = [
    { id: 'shift', headerKey: 'operations.colShift', render: (row) => shiftLabel(row) },
    {
      id: 'services',
      headerKey: 'operations.services',
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

  const vehicleColumns: Array<Column<HaulCycleReport['byVehicle'][number]>> = [
    { id: 'vehicle', headerKey: 'operations.colVehicle', render: (row) => row.vehicleName },
    {
      id: 'services',
      headerKey: 'operations.services',
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

  const driverColumns: Array<Column<HaulCycleReport['byDriverShift'][number]>> = [
    { id: 'driver', headerKey: 'operations.colDriver', render: (row) => row.driverName },
    { id: 'shift', headerKey: 'operations.colShift', render: (row) => shiftLabel(row) },
    {
      id: 'vehicles',
      headerKey: 'operations.colVehicles',
      render: (row) => (row.vehicleNames ?? []).join('، '),
    },
    {
      id: 'services',
      headerKey: 'operations.services',
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

  const shovelColumns: Array<Column<HaulCycleReport['byShovel'][number]>> = [
    { id: 'shovel', headerKey: 'operations.colShovel', render: (row) => row.shovelLabel },
    { id: 'loads', headerKey: 'operations.loads', render: (row) => numText(row.loads, lang, 0) },
  ];

  const cycleColumns: Array<Column<HaulCycleReport['cycles'][number]>> = [
    {
      id: 'time',
      headerKey: 'operations.colTime',
      render: (row) => stampText(row.originEnteredAt, lang),
    },
    { id: 'vehicle', headerKey: 'operations.colVehicle', render: (row) => row.vehicleName },
    {
      id: 'driver',
      headerKey: 'operations.colDriver',
      render: (row) => (
        <>
          {row.driverName ?? '—'}
          {row.driverSource === 'ASSIGNMENT' && (
            <span className="ms-1 text-xs text-gray-500">({t('operations.fromAssignment')})</span>
          )}
        </>
      ),
    },
    { id: 'shovel', headerKey: 'operations.colShovel', render: (row) => row.shovelLabel ?? '—' },
    { id: 'shift', headerKey: 'operations.colShift', render: (row) => shiftLabel(row) },
    {
      id: 'load',
      headerKey: 'operations.colLoad',
      render: (row) => hoursText(row.loadDwellSec, lang),
    },
    {
      id: 'travel',
      headerKey: 'operations.colTravel',
      render: (row) => hoursText(row.travelSec, lang),
    },
    {
      id: 'distance',
      headerKey: 'operations.colDistance',
      render: (row) => numText(row.distanceKm, lang),
    },
  ];

  if (loading && !data) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
      <div className="flex flex-col gap-4" role="status">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder.
            <Skeleton key={i} className="h-[84px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[300px] rounded-2xl" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="haul-results">
      {data.truncated && <Alert variant="warning">{t('operations.truncated')}</Alert>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label={t('operations.ui.services.kpiServices')}
          value={numText(data.services, lang, 0)}
          hint={`${t('operations.ui.services.kpiTrucks')}: ${numText(trucks, lang, 0)}`}
          icon={Truck}
          tone="brand"
        />
        <StatCard
          label={t('operations.ui.services.kpiDistance')}
          value={numText(data.distanceKm, lang)}
          unit={t('operations.ui.unitKm')}
          icon={Route}
          tone="info"
        />
        <StatCard
          label={t('operations.ui.services.kpiHours')}
          value={hoursText(totalSec, lang)}
          unit={t('operations.ui.unitH')}
          icon={Timer}
          tone="success"
        />
        <StatCard
          label={t('operations.ui.services.kpiOpen')}
          value={numText(data.openHauls.length, lang, 0)}
          icon={Gauge}
          tone={data.openHauls.length > 0 ? 'warning' : 'info'}
        />
      </div>

      {data.openHauls.length > 0 && (
        <Alert variant="info">
          {t('operations.openHauls')}:{' '}
          {data.openHauls
            .map((row) => `${row.vehicleName} (${stampText(row.since, lang)})`)
            .join('، ')}
        </Alert>
      )}
      {data.unbound.length > 0 && (
        <Alert variant="warning">
          {t('operations.unboundMembers')}:{' '}
          {data.unbound.map((row) => row.imei ?? row.deviceId).join('، ')}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          aria-label={t('operations.ui.services.viewsLabel')}
          value={view}
          onChange={setView}
          options={VIEWS.map((value) => ({
            value,
            label: t(`operations.ui.services.views.${value}`),
          }))}
        />
        <Button
          size="sm"
          variant="outline"
          leftIcon={<Download size={14} />}
          disabled={exporting}
          data-testid="export-haul"
          onClick={onExport}
        >
          {exporting ? t('operations.exporting') : t('operations.exportExcel')}
        </Button>
      </div>

      {view === 'shift' && (
        <>
          <ChartPanel
            title={t('operations.ui.services.chartShift')}
            type="line"
            series={shiftChart.series}
            options={shiftChart.options}
            empty={shifts.length === 0}
          />
          <Panel title={t('operations.byShift')}>
            <OpsTable
              testId="haul-by-shift"
              columns={shiftColumns}
              rows={shifts}
              rowKey={(row) => row.shift}
            />
          </Panel>
        </>
      )}

      {view === 'vehicle' && (
        <>
          <ChartPanel
            title={t('operations.ui.services.chartVehicle')}
            type="bar"
            series={[{ name: t('operations.services'), data: vehicles.map((row) => row.services) }]}
            options={barOptions(
              vehicles.map((row) => clip(row.vehicleName)),
              chart.distance,
            )}
            height={barsHeight(vehicles.length)}
            empty={vehicles.length === 0}
          />
          <Panel title={t('operations.byVehicle')}>
            <OpsTable columns={vehicleColumns} rows={vehicles} rowKey={(row) => row.vehicleId} />
          </Panel>
        </>
      )}

      {view === 'driver' && (
        <>
          <ChartPanel
            title={t('operations.ui.services.chartDriver')}
            type="bar"
            series={[
              { name: t('operations.services'), data: driverRows.map((row) => row.services) },
            ]}
            options={barOptions(
              driverRows.map((row) =>
                clip(
                  row.shiftNo > 0
                    ? `${row.driverName} · ${t('operations.shiftN', { n: row.shiftNo })}`
                    : row.driverName,
                  24,
                ),
              ),
              chart.moving,
            )}
            height={barsHeight(driverRows.length)}
            empty={driverRows.length === 0}
          />
          <Panel title={t('operations.byDriver')}>
            <OpsTable
              columns={driverColumns}
              rows={driverRows}
              rowKey={(row) => `${row.driverId}-${row.shift}`}
            />
          </Panel>
        </>
      )}

      {view === 'shovel' && (
        <>
          <ChartPanel
            title={t('operations.ui.services.chartShovel')}
            type="bar"
            series={[{ name: t('operations.loads'), data: shovels.map((row) => row.loads) }]}
            options={barOptions(
              shovels.map((row) => clip(row.shovelLabel)),
              chart.peak,
            )}
            height={barsHeight(shovels.length)}
            empty={shovels.length === 0}
          />
          <Panel title={t('operations.byShovel')}>
            <OpsTable columns={shovelColumns} rows={shovels} rowKey={(row) => row.shovelId} />
          </Panel>
        </>
      )}

      {view === 'list' && (
        <Panel title={t('operations.cycles')}>
          <OpsTable
            columns={cycleColumns}
            rows={data.cycles}
            rowKey={(row) => `${row.vehicleId}-${row.originEnteredAt}`}
          />
        </Panel>
      )}
    </div>
  );
}

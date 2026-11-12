/**
 * The services behind a count: opened by clicking a number in the services
 * report (a truck in a shift, a driver, a shift). Lists every service and
 * shows on the map where each one loaded and dumped; the row and the pins
 * share a number, and picking either highlights the other.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGeofences } from '@/api/geofence.api';
import type { HaulCycleReport, HaulCycleRow } from '@/api/operations.api';
import {
  DUMP_COLOR,
  LOAD_COLOR,
  type ServicePoint,
  ServicePointsMap,
} from '@/components/operations/ServicePointsMap';
import { OpsTable, hoursText, numText } from '@/components/operations/ops-ui';
import type { Column } from '@/components/reports/ReportsTable';
import { startEndColumns } from '@/components/reports/dateTimeColumns';
import { Alert, Modal } from '@/components/tailwind-ui';

export interface ServiceDetail {
  readonly title: string;
  readonly cycles: readonly HaulCycleRow[];
}

type NumberedCycle = HaulCycleRow & { no: number };

export function ServiceDetailsModal({
  detail,
  route,
  shiftLabel,
  onClose,
}: {
  detail: ServiceDetail | null;
  route: HaulCycleReport['route'] | undefined;
  shiftLabel: (row: HaulCycleRow) => string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const geofences = useGeofences();
  const [selectedNo, setSelectedNo] = useState<number | null>(null);

  const rows = useMemo<NumberedCycle[]>(
    () => (detail?.cycles ?? []).map((cycle, i) => ({ ...cycle, no: i + 1 })),
    [detail],
  );
  const points = useMemo<ServicePoint[]>(
    () =>
      rows.flatMap((row) =>
        row.loadPoint && row.dumpPoint
          ? [
              {
                no: row.no,
                load: row.loadPoint,
                dump: row.dumpPoint,
                title: `${row.vehicleName}${row.driverName ? ` · ${row.driverName}` : ''}`,
              },
            ]
          : [],
      ),
    [rows],
  );
  const zones = useMemo(() => {
    const byId = new Map((geofences.data ?? []).map((g) => [g.id, g]));
    return {
      origin: route?.originGeofenceId ? (byId.get(route.originGeofenceId) ?? null) : null,
      destination: route?.destinationGeofenceId
        ? (byId.get(route.destinationGeofenceId) ?? null)
        : null,
    };
  }, [geofences.data, route]);

  const columns: Array<Column<NumberedCycle>> = [
    {
      id: 'no',
      header: '#',
      render: (row) => (
        <button
          type="button"
          className={`min-w-6 rounded-full px-1.5 text-xs font-semibold ${
            row.no === selectedNo
              ? 'bg-sky-500 text-white'
              : 'bg-gray-100 text-gray-700 dark:bg-graydark-300 dark:text-graydark-800'
          }`}
          data-testid={`service-row-${row.no}`}
          onClick={() => setSelectedNo(row.no)}
        >
          {numText(row.no, lang, 0)}
        </button>
      ),
    },
    ...startEndColumns(
      (row: NumberedCycle) => row.originEnteredAt,
      (row) => row.destinationEnteredAt,
      lang,
    ),
    { id: 'vehicle', headerKey: 'operations.colVehicle', render: (row) => row.vehicleName },
    { id: 'driver', headerKey: 'operations.colDriver', render: (row) => row.driverName ?? '—' },
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

  return (
    <Modal
      open={detail !== null}
      onClose={() => {
        setSelectedNo(null);
        onClose();
      }}
      size="xl"
      title={
        detail
          ? `${detail.title} — ${t('operations.ui.services.detailCount', {
              count: detail.cycles.length,
              n: numText(detail.cycles.length, lang, 0),
            })}`
          : ''
      }
    >
      {detail && (
        <div className="flex flex-col gap-3" data-testid="service-details">
          {points.length > 0 ? (
            <>
              <ServicePointsMap
                points={points}
                zones={zones}
                selectedNo={selectedNo}
                onSelect={setSelectedNo}
              />
              <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-graydark-700">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-3 rounded-full" style={{ background: LOAD_COLOR }} />
                  {t('operations.ui.services.loadedHere')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-3 rounded-full" style={{ background: DUMP_COLOR }} />
                  {t('operations.ui.services.dumpedHere')}
                </span>
              </div>
            </>
          ) : (
            <Alert variant="info">{t('operations.ui.services.noPoints')}</Alert>
          )}
          <OpsTable
            testId="service-details-list"
            columns={columns}
            rows={rows}
            rowKey={(row) => `${row.vehicleId}-${row.originEnteredAt}`}
          />
        </div>
      )}
    </Modal>
  );
}

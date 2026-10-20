/**
 * Vehicle driving-behavior panel — score for the car over the last 30 days,
 * who drove it (per-driver split) and the latest behavior events.
 */
import { useTranslation } from 'react-i18next';

import { driverFullName, useVehicleBehavior, useVehicleBehaviorEvents } from '@/api/driver.api';
import { Badge, Spinner } from '@/components/tailwind-ui';
import { formatDateTime } from '@/lib/format-date';
import type { Driver } from '@/types/asset.types';

interface VehicleBehaviorPanelProps {
  vehicleId: string | null;
  /** Known drivers — resolves names on events (the score payload already carries its own). */
  drivers: Driver[];
}

export function VehicleBehaviorPanel({ vehicleId, drivers }: VehicleBehaviorPanelProps) {
  const { t } = useTranslation();
  const { data: behavior, isLoading, isError } = useVehicleBehavior(vehicleId);
  const { data: events = [], isLoading: eventsLoading } = useVehicleBehaviorEvents(vehicleId);

  const driverName = (id: string | null): string => {
    if (!id) return t('assets.vehicle.behaviorUnattributed');
    const known = drivers.find((d) => d.id === id);
    if (known) return driverFullName(known);
    const row = behavior?.drivers.find((d) => d.driverId === id);
    return row ? `${row.firstName} ${row.lastName}`.trim() : '—';
  };

  return (
    <>
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
        {t('assets.vehicle.behaviorHint')}
      </p>
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      ) : isError || !behavior ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('assets.vehicle.behaviorUnavailable')}
        </p>
      ) : behavior.eventCount === 0 ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-gray-900 dark:text-white">
              {Math.round(behavior.score)}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">/ 100</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('assets.vehicle.behaviorNoEvents')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums text-gray-900 dark:text-white">
                {Math.round(behavior.score)}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">/ 100</span>
              {behavior.needsAttention && (
                <Badge color="warning">{t('assets.driver.needsAttention')}</Badge>
              )}
            </div>
            {behavior.delta != null && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('assets.driver.scoreDelta', {
                  delta:
                    behavior.delta > 0
                      ? `+${Math.round(behavior.delta)}`
                      : String(Math.round(behavior.delta)),
                  previous: behavior.previousScore ?? '—',
                })}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
              <span>
                {t('assets.driver.eventHarshBrake')}: {behavior.harshBrakeCount}
              </span>
              <span>
                {t('assets.driver.eventRapidAccel')}: {behavior.rapidAccelCount}
              </span>
              <span>
                {t('assets.driver.eventOverspeed')}: {behavior.speedViolationCount}
              </span>
              <span>
                {t('assets.driver.eventIdle')}: {behavior.excessiveIdleCount}
              </span>
            </div>
            {behavior.unattributedCount > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('assets.vehicle.behaviorUnattributedCount', {
                  count: behavior.unattributedCount,
                })}
              </p>
            )}
          </div>

          {behavior.drivers.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('assets.vehicle.behaviorDrivers')}
              </p>
              <ul className="flex flex-col gap-1.5">
                {behavior.drivers.map((d) => (
                  <li
                    key={d.driverId}
                    className="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700"
                  >
                    <span className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-100">
                      {driverName(d.driverId)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-gray-500 dark:text-gray-400">
                      <span>{t('assets.vehicle.behaviorEventCount', { count: d.eventCount })}</span>
                      <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                        {Math.round(d.score)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t('assets.driver.behaviorEvents')}
        </p>
        {eventsLoading ? (
          <div className="flex justify-center py-3">
            <Spinner size="sm" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('assets.vehicle.behaviorEventsEmpty')}
          </p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
            {events.slice(0, 20).map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1.5 text-xs dark:border-gray-700"
              >
                <span className="min-w-0">
                  <span className="font-medium text-gray-800 dark:text-gray-100">
                    {t(`assets.driver.eventType.${ev.type}`, { defaultValue: ev.type })}
                  </span>
                  <span className="ms-2 text-gray-500 dark:text-gray-400">
                    {driverName(ev.driverId)}
                  </span>
                </span>
                <span className="shrink-0 text-gray-500 dark:text-gray-400">
                  {ev.raisedAt ? formatDateTime(ev.raisedAt) : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * Services setup tab: create a haul service, change its shifts, and choose
 * the machines and the driver of each shift.
 *
 * The machine type (truck / shovel) is defined once on the vehicle and the
 * driver of each shift comes from the driver assignment on the vehicle; a
 * service can still override either.
 */
import { MapPinned, Plus, Truck } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDevices, useVehicles } from '@/api/asset.api';
import { driverFullName, useDrivers } from '@/api/driver.api';
import { useGeofences } from '@/api/geofence.api';
import {
  type HaulRoute,
  type MachineRole,
  useArchiveHaulRoute,
  useCreateHaulRoute,
  useHaulMembers,
  useHaulRoutes,
  useSetHaulMembers,
  useUpdateHaulRoute,
} from '@/api/operations.api';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { Panel } from '@/components/operations/ops-ui';
import { Alert, Badge, Button, Input, Select } from '@/components/tailwind-ui';

const DAY_MINUTES = 24 * 60;

/** `HH:MM` for a minute of the day (wraps past midnight). */
function clock(minuteOfDay: number): string {
  const wrapped = ((Math.round(minuteOfDay) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** The `<input type="time">` value of a start hour and minute. */
function timeValue(hour: number, minute: number): string {
  return clock(hour * 60 + minute);
}

/** Hour and minute of an `HH:MM` time value; null while the field is empty. */
function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Minutes past midnight of an `HH:MM` value; null while the field is empty. */
function minuteOfDay(value: string): number | null {
  const time = parseTime(value);
  return time ? time.hour * 60 + time.minute : null;
}

/** The lunch break of a form: both ends, neither, or an error when only one is given. */
function lunchOf(
  start: string,
  end: string,
): { start: number | null; end: number | null; error: 'half' | 'same' | null } {
  const from = minuteOfDay(start);
  const to = minuteOfDay(end);
  if (from === null && to === null) return { start: null, end: null, error: null };
  if (from === null || to === null) return { start: from, end: to, error: 'half' };
  if (from === to) return { start: from, end: to, error: 'same' };
  return { start: from, end: to, error: null };
}

/** `[start, end)` local times of every shift in the work day. */
export function shiftPlan(
  startMinute: number,
  durationMinutes: number,
  count: number,
): Array<{ no: number; from: string; to: string }> {
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const from = startMinute + index * durationMinutes;
    return { no: index + 1, from: clock(from), to: clock(from + durationMinutes) };
  });
}

function maxShifts(durationMinutes: number): number {
  return Math.max(1, Math.min(4, Math.floor(DAY_MINUTES / Math.max(1, durationMinutes))));
}

/** Shift length as `8:15`-style text for the route list. */
function lengthText(hours: number, minutes: number): string {
  return minutes > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : String(hours);
}

export function RoutesTab({
  routeId,
  onSelect,
}: {
  routeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const routes = useHaulRoutes();
  const geofences = useGeofences();
  const devices = useDevices();
  const vehicles = useVehicles();
  const drivers = useDrivers();
  const members = useHaulMembers(routeId);
  const createRoute = useCreateHaulRoute();
  const saveMembers = useSetHaulMembers(routeId);
  const archiveRoute = useArchiveHaulRoute();

  const [name, setName] = useState('');
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [shiftStart, setShiftStart] = useState('06:00');
  const [shiftHours, setShiftHours] = useState(12);
  const [shiftMinutes, setShiftMinutes] = useState(0);
  const [shiftCount, setShiftCount] = useState(2);
  const [lunchFrom, setLunchFrom] = useState('');
  const [lunchTo, setLunchTo] = useState('');
  const [handoverWindow, setHandoverWindow] = useState(30);
  const [roles, setRoles] = useState<Record<string, '' | MachineRole>>({});
  const [rosters, setRosters] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const route = (routes.data ?? []).find((row) => row.id === routeId) ?? null;
  const routeShifts = route?.shiftCount ?? 1;

  useEffect(() => {
    if (!members.data) return;
    setRoles((prev) => {
      const next: Record<string, '' | MachineRole> = {};
      for (const member of members.data ?? []) next[member.deviceId] = member.role;
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === next[key])) {
        return prev;
      }
      return next;
    });
    const nextRosters: Record<string, string[]> = {};
    for (const member of members.data ?? []) {
      nextRosters[member.deviceId] = (member.shiftDrivers ?? []).map((id) => id ?? '');
    }
    setRosters((prev) => {
      const same =
        Object.keys(prev).length === Object.keys(nextRosters).length &&
        Object.entries(nextRosters).every(
          ([key, ids]) => (prev[key] ?? []).join(',') === ids.join(','),
        );
      return same ? prev : nextRosters;
    });
  }, [members.data]);

  const places = (geofences.data ?? []).filter((place) => place.status !== 'ARCHIVED');
  const units = (devices.data ?? []).filter((device) => device.status !== 'DECOMMISSIONED');
  const activeDrivers = (drivers.data ?? []).filter((driver) => driver.status === 'ACTIVE');
  const createStart = parseTime(shiftStart);
  const createLength = shiftHours * 60 + shiftMinutes;
  const createTooLong = shiftCount * createLength > DAY_MINUTES;

  // The machine type lives on the vehicle, so a device's role follows the
  // vehicle it is bound to without being picked again on every route.
  const typeOfDevice = useMemo(() => {
    const byVehicle = new Map((vehicles.data ?? []).map((v) => [v.id, v.machineType]));
    return new Map(
      (devices.data ?? []).map((device) => [
        device.id,
        (device.vehicleId ? byVehicle.get(device.vehicleId) : null) ?? null,
      ]),
    );
  }, [vehicles.data, devices.data]);

  const vehicleNameOfDevice = useMemo(() => {
    const byVehicle = new Map((vehicles.data ?? []).map((v) => [v.id, v.name]));
    return (vehicleId: string | null | undefined) =>
      vehicleId ? (byVehicle.get(vehicleId) ?? null) : null;
  }, [vehicles.data]);

  // Drivers assigned on the vehicle, by shift: the default roster of a truck.
  const assignedByVehicle = useMemo(() => {
    const out = new Map<string, Map<number | 'any', string>>();
    for (const driver of drivers.data ?? []) {
      if (!driver.assignedVehicleId || driver.status !== 'ACTIVE') continue;
      const slots = out.get(driver.assignedVehicleId) ?? new Map<number | 'any', string>();
      slots.set(driver.assignedShift ?? 'any', driverFullName(driver));
      out.set(driver.assignedVehicleId, slots);
    }
    return out;
  }, [drivers.data]);

  const assignedDriverName = (deviceId: string, shiftNo: number): string | null => {
    const vehicleId = (devices.data ?? []).find((d) => d.id === deviceId)?.vehicleId;
    const slots = vehicleId ? assignedByVehicle.get(vehicleId) : undefined;
    return slots?.get(shiftNo) ?? slots?.get('any') ?? null;
  };

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    if (createTooLong) {
      setFormError(t('operations.shiftTooLong'));
      return;
    }
    if (!createStart || createLength < 1) {
      setFormError(t('operations.shiftInvalid'));
      return;
    }
    const createLunch = lunchOf(lunchFrom, lunchTo);
    if (createLunch.error) {
      setFormError(t(`operations.lunchInvalid.${createLunch.error}`));
      return;
    }
    try {
      const created = await createRoute.mutateAsync({
        name: name.trim(),
        originGeofenceId: originId,
        destinationGeofenceId: destinationId,
        shiftStartHour: createStart.hour,
        shiftStartMinute: createStart.minute,
        shiftDurationHours: shiftHours,
        shiftDurationMinutes: shiftMinutes,
        shiftCount,
        lunchStartMinute: createLunch.start,
        lunchEndMinute: createLunch.end,
        handoverWindowMinutes: handoverWindow,
      });
      setName('');
      setLunchFrom('');
      setLunchTo('');
      onSelect(created.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('operations.saveFailed'));
    }
  };

  const onSaveMembers = async () => {
    if (!routeId) return;
    setFormError(null);
    setNotice(null);
    const assigned = Object.entries(roles)
      .filter(
        (entry): entry is [string, MachineRole] => entry[1] === 'TRUCK' || entry[1] === 'SHOVEL',
      )
      .map(([deviceId, role]) => ({
        deviceId,
        role,
        shiftDrivers:
          role === 'TRUCK'
            ? Array.from({ length: routeShifts }, (_, i) => rosters[deviceId]?.[i] || null)
            : [],
      }));
    try {
      await saveMembers.mutateAsync(assigned);
      setNotice(t('operations.saved'));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('operations.saveFailed'));
    }
  };

  const onArchive = async () => {
    if (!routeId) return;
    setFormError(null);
    try {
      await archiveRoute.mutateAsync(routeId);
      setConfirmArchive(false);
      onSelect(null);
    } catch (err) {
      setConfirmArchive(false);
      setFormError(err instanceof Error ? err.message : t('operations.saveFailed'));
    }
  };

  const setRosterDriver = (deviceId: string, shiftIndex: number, driverId: string) =>
    setRosters((prev) => {
      const roster = [...(prev[deviceId] ?? [])];
      while (roster.length <= shiftIndex) roster.push('');
      roster[shiftIndex] = driverId;
      return { ...prev, [deviceId]: roster };
    });

  const placeOptions = (
    <>
      <option value="">{t('operations.pickPlace')}</option>
      {places.map((place) => (
        <option key={place.id} value={place.id}>
          {place.name}
        </option>
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="operations-routes">
      <p className="text-sm leading-6 text-gray-500 dark:text-graydark-600">
        {t('operations.haulHint')}
      </p>
      {formError && (
        <Alert variant="danger" onClose={() => setFormError(null)}>
          {formError}
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Panel
            title={t('operations.ui.routes.listTitle')}
            hint={t('operations.ui.routes.pickHint')}
          >
            {(routes.data ?? []).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-graydark-600">
                {t('operations.ui.routes.empty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="route-list">
                {(routes.data ?? []).map((row) => {
                  const active = row.id === routeId;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          onSelect(row.id);
                          setNotice(null);
                          setFormError(null);
                        }}
                        className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-start transition-colors ${
                          active
                            ? 'border-brand-500 bg-brand-50 dark:border-brand-400/60 dark:bg-brand-500/10'
                            : 'border-gray-200 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5'
                        }`}
                      >
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                          <MapPinned size={17} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-gray-800 dark:text-white">
                            {row.name}
                          </span>
                          <span className="block truncate text-xs text-gray-500 dark:text-graydark-600">
                            {t('operations.ui.routes.shiftsSummary', {
                              count: row.shiftCount,
                              hours: lengthText(
                                row.shiftDurationHours,
                                row.shiftDurationMinutes ?? 0,
                              ),
                              start: timeValue(row.shiftStartHour, row.shiftStartMinute ?? 0),
                            })}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel
            title={t('operations.ui.routes.newTitle')}
            hint={t('operations.ui.routes.newHint')}
          >
            <form
              data-testid="haul-route-form"
              onSubmit={onCreate}
              className="grid gap-3 sm:grid-cols-2"
            >
              <Input
                wrapperClassName="sm:col-span-2"
                label={t('operations.routeName')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
              />
              <Select
                label={t('operations.origin')}
                aria-label={t('operations.origin')}
                value={originId}
                onChange={(event) => setOriginId(event.target.value)}
                required
              >
                {placeOptions}
              </Select>
              <Select
                label={t('operations.destination')}
                aria-label={t('operations.destination')}
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
                required
              >
                {placeOptions}
              </Select>
              <Input
                label={t('operations.shiftStart')}
                type="time"
                step={60}
                value={shiftStart}
                onChange={(event) => setShiftStart(event.target.value)}
                required
              />
              <ShiftLengthFields
                hours={shiftHours}
                minutes={shiftMinutes}
                onHours={setShiftHours}
                onMinutes={setShiftMinutes}
              />
              <Input
                label={t('operations.shiftCount')}
                type="number"
                min={1}
                max={maxShifts(createLength)}
                value={shiftCount}
                onChange={(event) => setShiftCount(Number(event.target.value))}
              />
              <BreakFields
                lunchFrom={lunchFrom}
                lunchTo={lunchTo}
                handoverWindow={handoverWindow}
                onLunchFrom={setLunchFrom}
                onLunchTo={setLunchTo}
                onHandoverWindow={setHandoverWindow}
              />
              <ShiftPlanNote
                startMinute={createStart ? createStart.hour * 60 + createStart.minute : 0}
                durationMinutes={createLength}
                count={shiftCount}
                tooLong={createTooLong}
              />
              <div className="sm:col-span-2">
                <Button
                  type="submit"
                  leftIcon={<Plus size={15} />}
                  disabled={createRoute.isPending}
                  loading={createRoute.isPending}
                >
                  {t('operations.createRoute')}
                </Button>
              </div>
            </form>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          {route && (
            <RouteSettings
              key={`${route.id}-${route.shiftStartHour}-${route.shiftDurationHours}-${route.shiftCount}`}
              route={route}
              onSaved={() => setNotice(t('operations.saved'))}
              onError={(message) => setFormError(message)}
              onArchive={() => setConfirmArchive(true)}
            />
          )}

          {routeId && (
            <Panel
              title={t('operations.ui.routes.machinesTitle')}
              hint={`${t('operations.membersHint')} ${t('operations.rosterHint')}`}
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="add-typed-machines"
                  onClick={() => {
                    const next = { ...roles };
                    let added = 0;
                    for (const device of units) {
                      const type = typeOfDevice.get(device.id);
                      if (type && !next[device.id]) {
                        next[device.id] = type;
                        added += 1;
                      }
                    }
                    setRoles(next);
                    setNotice(t('operations.addAllTypedDone', { count: added }));
                  }}
                >
                  {t('operations.addAllTyped')}
                </Button>
              }
            >
              <ul className="flex flex-col gap-2">
                {units.map((device) => {
                  const type = typeOfDevice.get(device.id) ?? null;
                  const role = roles[device.id] ?? '';
                  const vehicleName = vehicleNameOfDevice(device.vehicleId);
                  return (
                    <li
                      key={device.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm dark:border-white/10"
                    >
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-graydark-600">
                        <Truck size={16} aria-hidden />
                      </span>
                      <span className="min-w-32">
                        <span className="block font-mono text-[13px] text-gray-800 dark:text-white">
                          {device.imei}
                        </span>
                        {vehicleName && (
                          <span className="block text-xs text-gray-500 dark:text-graydark-600">
                            {vehicleName}
                          </span>
                        )}
                      </span>
                      {type ? (
                        <>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              aria-label={device.imei}
                              data-testid={`member-${device.id}`}
                              className="size-4 cursor-pointer accent-brand-500"
                              checked={role !== ''}
                              onChange={(event) =>
                                setRoles((prev) => ({
                                  ...prev,
                                  [device.id]: event.target.checked ? type : '',
                                }))
                              }
                            />
                            {t('operations.inService')}
                          </label>
                          <span title={t('operations.machineTypeFromVehicle')}>
                            <Badge color={type === 'TRUCK' ? 'brand' : 'warning'}>
                              {t(`assets.vehicle.machineTypes.${type}`)}
                            </Badge>
                          </span>
                        </>
                      ) : (
                        <>
                          <Select
                            aria-label={device.imei}
                            wrapperClassName="w-44"
                            value={role}
                            onChange={(event) =>
                              setRoles((prev) => ({
                                ...prev,
                                [device.id]: event.target.value as '' | MachineRole,
                              }))
                            }
                          >
                            <option value="">{t('operations.roleNone')}</option>
                            <option value="TRUCK">{t('operations.roleTruck')}</option>
                            <option value="SHOVEL">{t('operations.roleShovel')}</option>
                          </Select>
                          {device.vehicleId && (
                            <Badge color="warning" title={t('operations.machineTypeMissing')}>
                              {t('operations.machineTypeMissing')}
                            </Badge>
                          )}
                        </>
                      )}
                      {role === 'TRUCK' && (
                        <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
                          {Array.from({ length: routeShifts }, (_, index) => {
                            const assigned = assignedDriverName(device.id, index + 1);
                            return (
                              <Select
                                // biome-ignore lint/suspicious/noArrayIndexKey: shift slots are positional
                                key={index}
                                wrapperClassName="w-52"
                                aria-label={`${device.imei} ${t('operations.shiftN', { n: index + 1 })}`}
                                data-testid={`roster-${device.id}-${index + 1}`}
                                value={rosters[device.id]?.[index] ?? ''}
                                onChange={(event) =>
                                  setRosterDriver(device.id, index, event.target.value)
                                }
                              >
                                <option value="">
                                  {t('operations.shiftN', { n: index + 1 })}:{' '}
                                  {assigned
                                    ? t('operations.assignedDriverHint', { name: assigned })
                                    : t('operations.noAssignedDriver')}
                                </option>
                                {activeDrivers.map((driver) => (
                                  <option key={driver.id} value={driver.id}>
                                    {t('operations.shiftN', { n: index + 1 })}: {driver.firstName}{' '}
                                    {driver.lastName}
                                  </option>
                                ))}
                              </Select>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4">
                <Button
                  disabled={saveMembers.isPending}
                  loading={saveMembers.isPending}
                  onClick={() => void onSaveMembers()}
                >
                  {t('operations.saveMembers')}
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title={t('operations.archiveRoute')}
        message={t('operations.archiveConfirm')}
        loading={archiveRoute.isPending}
        onConfirm={() => void onArchive()}
        onClose={() => setConfirmArchive(false)}
      />
    </div>
  );
}

/**
 * The planned stops of a service: the lunch break and the shift handover. A
 * stop inside the lunch window, or an engine-off stop within the handover
 * window of a shift boundary, is reported apart from the machine's own stops.
 */
function BreakFields({
  lunchFrom,
  lunchTo,
  handoverWindow,
  onLunchFrom,
  onLunchTo,
  onHandoverWindow,
}: {
  lunchFrom: string;
  lunchTo: string;
  handoverWindow: number;
  onLunchFrom: (value: string) => void;
  onLunchTo: (value: string) => void;
  onHandoverWindow: (value: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3" data-testid="haul-break-fields">
      <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-graydark-800">
        {t('operations.plannedStops')}
      </legend>
      <Input
        label={t('operations.lunchFrom')}
        type="time"
        step={60}
        value={lunchFrom}
        onChange={(event) => onLunchFrom(event.target.value)}
      />
      <Input
        label={t('operations.lunchTo')}
        type="time"
        step={60}
        value={lunchTo}
        onChange={(event) => onLunchTo(event.target.value)}
      />
      <Input
        label={t('operations.handoverWindow')}
        type="number"
        min={0}
        max={120}
        value={handoverWindow}
        onChange={(event) => onHandoverWindow(Number(event.target.value))}
        hint={t('operations.handoverWindowHint')}
      />
    </fieldset>
  );
}

/** Shift length as an hours field and a minutes field. */
function ShiftLengthFields({
  hours,
  minutes,
  onHours,
  onMinutes,
}: {
  hours: number;
  minutes: number;
  onHours: (value: number) => void;
  onMinutes: (value: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        label={t('operations.shiftDuration')}
        type="number"
        min={0}
        max={24}
        value={hours}
        onChange={(event) => onHours(Number(event.target.value))}
      />
      <Input
        label={t('operations.shiftDurationMinutes')}
        type="number"
        min={0}
        max={59}
        value={minutes}
        onChange={(event) => onMinutes(Number(event.target.value))}
      />
    </div>
  );
}

function ShiftPlanNote({
  startMinute,
  durationMinutes,
  count,
  tooLong,
}: {
  startMinute: number;
  durationMinutes: number;
  count: number;
  tooLong: boolean;
}) {
  const { t } = useTranslation();
  if (tooLong) {
    return <p className="text-sm text-danger-600 sm:col-span-2">{t('operations.shiftTooLong')}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5 sm:col-span-2" data-testid="shift-plan">
      <span className="sr-only">{t('operations.shiftPlan')}: </span>
      {shiftPlan(startMinute, durationMinutes, count).map((shift) => (
        <Badge key={shift.no} color="gray">
          {`${t('operations.shiftN', { n: shift.no })} ${shift.from}–${shift.to}`}
        </Badge>
      ))}
    </div>
  );
}

function RouteSettings({
  route,
  onSaved,
  onError,
  onArchive,
}: {
  route: HaulRoute;
  onSaved: () => void;
  onError: (message: string) => void;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateHaulRoute(route.id);
  const [name, setName] = useState(route.name);
  const [start, setStart] = useState(timeValue(route.shiftStartHour, route.shiftStartMinute ?? 0));
  const [hours, setHours] = useState(route.shiftDurationHours);
  const [minutes, setMinutes] = useState(route.shiftDurationMinutes ?? 0);
  const [count, setCount] = useState(route.shiftCount ?? 1);
  const [lunchFrom, setLunchFrom] = useState(
    route.lunchStartMinute === null || route.lunchStartMinute === undefined
      ? ''
      : clock(route.lunchStartMinute),
  );
  const [lunchTo, setLunchTo] = useState(
    route.lunchEndMinute === null || route.lunchEndMinute === undefined
      ? ''
      : clock(route.lunchEndMinute),
  );
  const [handoverWindow, setHandoverWindow] = useState(route.handoverWindowMinutes ?? 30);
  const startAt = parseTime(start);
  const length = hours * 60 + minutes;
  const tooLong = count * length > DAY_MINUTES;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (tooLong) {
      onError(t('operations.shiftTooLong'));
      return;
    }
    if (!startAt || length < 1) {
      onError(t('operations.shiftInvalid'));
      return;
    }
    const lunch = lunchOf(lunchFrom, lunchTo);
    if (lunch.error) {
      onError(t(`operations.lunchInvalid.${lunch.error}`));
      return;
    }
    try {
      await update.mutateAsync({
        name: name.trim(),
        shiftStartHour: startAt.hour,
        shiftStartMinute: startAt.minute,
        shiftDurationHours: hours,
        shiftDurationMinutes: minutes,
        shiftCount: count,
        lunchStartMinute: lunch.start,
        lunchEndMinute: lunch.end,
        handoverWindowMinutes: handoverWindow,
      });
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('operations.saveFailed'));
    }
  };

  return (
    <Panel title={`${t('operations.routeSettings')} — ${route.name}`}>
      <form
        data-testid="haul-route-settings"
        onSubmit={onSubmit}
        className="grid gap-3 sm:grid-cols-2"
      >
        <Input
          wrapperClassName="sm:col-span-2"
          label={t('operations.routeName')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={200}
        />
        <Input
          label={t('operations.shiftStart')}
          type="time"
          step={60}
          value={start}
          onChange={(event) => setStart(event.target.value)}
          required
        />
        <ShiftLengthFields
          hours={hours}
          minutes={minutes}
          onHours={setHours}
          onMinutes={setMinutes}
        />
        <Input
          label={t('operations.shiftCount')}
          type="number"
          min={1}
          max={maxShifts(length)}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        />
        <BreakFields
          lunchFrom={lunchFrom}
          lunchTo={lunchTo}
          handoverWindow={handoverWindow}
          onLunchFrom={setLunchFrom}
          onLunchTo={setLunchTo}
          onHandoverWindow={setHandoverWindow}
        />
        <ShiftPlanNote
          startMinute={startAt ? startAt.hour * 60 + startAt.minute : 0}
          durationMinutes={length}
          count={count}
          tooLong={tooLong}
        />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={update.isPending} loading={update.isPending}>
            {t('operations.saveRoute')}
          </Button>
          <Button type="button" variant="ghost" className="text-danger-600" onClick={onArchive}>
            {t('operations.archiveRoute')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

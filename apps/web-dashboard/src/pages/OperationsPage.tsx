/**
 * Mine operations (`/operations`).
 *
 * Device activity answers when a machine started sending positions, how much
 * data arrived, how long it was offline, and how far it travelled. A haul
 * route names an origin, a destination, the shifts of the work day (two by
 * default), and the trucks and shovels on that service. Each truck carries a
 * per-shift driver roster, since two shifts drive the same truck. Each
 * origin → destination pass is one service for the truck, the driver of that
 * shift, and the shovel that was loading.
 */
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDevices } from '@/api/asset.api';
import { useDrivers } from '@/api/driver.api';
import { useGeofences } from '@/api/geofence.api';
import {
  type HaulRoute,
  type ReportPreset,
  useArchiveHaulRoute,
  useCreateHaulRoute,
  useDeviceActivity,
  useHaulCycles,
  useHaulMembers,
  useHaulRoutes,
  useSetHaulMembers,
  useUpdateHaulRoute,
} from '@/api/operations.api';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { PageHeader } from '@/components/tailwind-ui';

const PRESETS: ReportPreset[] = ['today', 'yesterday', '7d', '30d'];

function hours(sec: number | null): string {
  if (sec === null) return '—';
  return (sec / 3600).toFixed(2);
}

function stamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function clock(hour: number): string {
  return `${String(((hour % 24) + 24) % 24).padStart(2, '0')}:00`;
}

/** `[start, end)` local hours of every shift in the work day. */
export function shiftPlan(startHour: number, durationHours: number, count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const from = startHour + index * durationHours;
    return { no: index + 1, from: clock(from), to: clock(from + durationHours) };
  });
}

function maxShifts(durationHours: number): number {
  return Math.max(1, Math.min(4, Math.floor(24 / Math.max(1, durationHours))));
}

export function OperationsPage() {
  const { t, i18n } = useTranslation();
  const [preset, setPreset] = useState<ReportPreset>('today');
  const [routeId, setRouteId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [shiftStart, setShiftStart] = useState(6);
  const [shiftHours, setShiftHours] = useState(12);
  const [shiftCount, setShiftCount] = useState(2);
  const [roles, setRoles] = useState<Record<string, '' | 'TRUCK' | 'SHOVEL'>>({});
  const [rosters, setRosters] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const activity = useDeviceActivity(preset);
  const routes = useHaulRoutes();
  const geofences = useGeofences();
  const devices = useDevices();
  const drivers = useDrivers();
  const members = useHaulMembers(routeId);
  const cycles = useHaulCycles(routeId, preset);
  const createRoute = useCreateHaulRoute();
  const saveMembers = useSetHaulMembers(routeId);
  const archiveRoute = useArchiveHaulRoute();

  const route = (routes.data ?? []).find((row) => row.id === routeId) ?? null;
  const routeShifts = route?.shiftCount ?? 1;

  useEffect(() => {
    if (!members.data) return;
    setRoles((prev) => {
      const next: Record<string, '' | 'TRUCK' | 'SHOVEL'> = {};
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
  const createTooLong = shiftCount * shiftHours > 24;

  const shiftLabel = (row: { shift: string; shiftDate: string | null; shiftNo: number }) => {
    if (row.shift === 'off-shift' || !row.shiftDate) return t('operations.offShift');
    const day = new Date(`${row.shiftDate}T12:00:00Z`);
    const date = Number.isNaN(day.getTime())
      ? row.shiftDate
      : day.toLocaleDateString(i18n.language === 'fa' ? 'fa-IR' : 'en-GB', { timeZone: 'UTC' });
    return `${date} · ${t('operations.shiftN', { n: row.shiftNo })}`;
  };

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    if (createTooLong) {
      setFormError(t('operations.shiftTooLong'));
      return;
    }
    try {
      const created = await createRoute.mutateAsync({
        name: name.trim(),
        originGeofenceId: originId,
        destinationGeofenceId: destinationId,
        shiftStartHour: shiftStart,
        shiftDurationHours: shiftHours,
        shiftCount,
      });
      setName('');
      setRouteId(created.id);
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
        (entry): entry is [string, 'TRUCK' | 'SHOVEL'] =>
          entry[1] === 'TRUCK' || entry[1] === 'SHOVEL',
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
      setRouteId(null);
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

  return (
    <div className="flex flex-col gap-6" data-testid="operations-page">
      <PageHeader title={t('operations.title')} description={t('operations.subtitle')} />

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((value) => (
          <button
            key={value}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              preset === value
                ? 'bg-brand-500 text-white'
                : 'bg-white text-slate-700 ring-1 ring-slate-200'
            }`}
            onClick={() => setPreset(value)}
          >
            {t(`operations.preset.${value}`)}
          </button>
        ))}
        <p className="basis-full text-xs text-slate-500">{t('operations.presetHint')}</p>
      </div>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t('operations.activityTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('operations.activityHint')}</p>
        {activity.isError && (
          <p className="mt-3 text-sm text-red-700">{t('operations.loadFailed')}</p>
        )}
        {activity.data && (
          <p className="mt-3 text-sm text-slate-700" data-testid="activity-totals">
            {t('operations.totalDistance')}: {activity.data.totalDistanceKm} km ·{' '}
            {t('operations.reportingCount')}: {activity.data.reportingCount} ·{' '}
            {t('operations.silentCount')}: {activity.data.silentCount}
          </p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-start text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">{t('operations.colImei')}</th>
                <th className="px-2 py-2 font-medium">{t('operations.colVehicle')}</th>
                <th className="px-2 py-2 font-medium">{t('operations.colStarted')}</th>
                <th className="px-2 py-2 font-medium">{t('operations.colFixes')}</th>
                <th className="px-2 py-2 font-medium">{t('operations.colOffline')}</th>
                <th className="px-2 py-2 font-medium">{t('operations.colDistance')}</th>
                <th className="px-2 py-2 font-medium">{t('operations.colSilent')}</th>
              </tr>
            </thead>
            <tbody>
              {(activity.data?.devices ?? []).map((row) => (
                <tr key={row.deviceId} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-mono">{row.imei}</td>
                  <td className="px-2 py-2">{row.vehicleName ?? t('operations.unbound')}</td>
                  <td className="px-2 py-2">{stamp(row.startedAt)}</td>
                  <td className="px-2 py-2">{row.fixes}</td>
                  <td className="px-2 py-2">{hours(row.offlineSec)}</td>
                  <td className="px-2 py-2">{row.distanceKm}</td>
                  <td className="px-2 py-2">
                    {row.silent ? t('operations.silentYes') : t('operations.silentNo')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{t('operations.haulTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('operations.haulHint')}</p>
        {formError && <p className="mt-3 text-sm text-red-700">{formError}</p>}
        {notice && <p className="mt-3 text-sm text-emerald-700">{notice}</p>}

        <form
          data-testid="haul-route-form"
          onSubmit={onCreate}
          className="mt-4 grid gap-3 sm:grid-cols-2"
        >
          <label className="text-sm font-medium">
            {t('operations.routeName')}
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label className="text-sm font-medium">
            {t('operations.origin')}
            <select
              aria-label={t('operations.origin')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={originId}
              onChange={(event) => setOriginId(event.target.value)}
              required
            >
              <option value="">{t('operations.pickPlace')}</option>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            {t('operations.destination')}
            <select
              aria-label={t('operations.destination')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
              required
            >
              <option value="">{t('operations.pickPlace')}</option>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            {t('operations.shiftStart')}
            <input
              type="number"
              min={0}
              max={23}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={shiftStart}
              onChange={(event) => setShiftStart(Number(event.target.value))}
            />
          </label>
          <label className="text-sm font-medium">
            {t('operations.shiftDuration')}
            <input
              type="number"
              min={1}
              max={24}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={shiftHours}
              onChange={(event) => setShiftHours(Number(event.target.value))}
            />
          </label>
          <label className="text-sm font-medium">
            {t('operations.shiftCount')}
            <input
              type="number"
              min={1}
              max={maxShifts(shiftHours)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={shiftCount}
              onChange={(event) => setShiftCount(Number(event.target.value))}
            />
          </label>
          <ShiftPlanNote
            startHour={shiftStart}
            durationHours={shiftHours}
            count={shiftCount}
            tooLong={createTooLong}
          />
          <button
            type="submit"
            disabled={createRoute.isPending}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2 sm:w-fit"
          >
            {t('operations.createRoute')}
          </button>
        </form>

        <label className="mt-4 block text-sm font-medium">
          {t('operations.pickRoute')}
          <select
            aria-label={t('operations.pickRoute')}
            data-testid="haul-route-select"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 sm:max-w-md"
            value={routeId ?? ''}
            onChange={(event) => {
              setRouteId(event.target.value || null);
              setNotice(null);
              setFormError(null);
            }}
          >
            <option value="">{t('operations.pickRoute')}</option>
            {(routes.data ?? []).map((route) => (
              <option key={route.id} value={route.id}>
                {route.name}
              </option>
            ))}
          </select>
        </label>

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
          <div className="mt-4">
            <h3 className="text-sm font-semibold">{t('operations.members')}</h3>
            <p className="mt-1 text-sm text-slate-600">{t('operations.membersHint')}</p>
            <p className="mt-1 text-sm text-slate-600">{t('operations.rosterHint')}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {units.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono">{device.imei}</span>
                  <select
                    aria-label={device.imei}
                    className="rounded-lg border border-slate-300 px-2 py-1"
                    value={roles[device.id] ?? ''}
                    onChange={(event) =>
                      setRoles((prev) => ({
                        ...prev,
                        [device.id]: event.target.value as '' | 'TRUCK' | 'SHOVEL',
                      }))
                    }
                  >
                    <option value="">{t('operations.roleNone')}</option>
                    <option value="TRUCK">{t('operations.roleTruck')}</option>
                    <option value="SHOVEL">{t('operations.roleShovel')}</option>
                  </select>
                  {roles[device.id] === 'TRUCK' &&
                    Array.from({ length: routeShifts }, (_, index) => (
                      <select
                        // biome-ignore lint/suspicious/noArrayIndexKey: shift slots are positional
                        key={index}
                        aria-label={`${device.imei} ${t('operations.shiftN', { n: index + 1 })}`}
                        data-testid={`roster-${device.id}-${index + 1}`}
                        className="rounded-lg border border-slate-300 px-2 py-1"
                        value={rosters[device.id]?.[index] ?? ''}
                        onChange={(event) => setRosterDriver(device.id, index, event.target.value)}
                      >
                        <option value="">
                          {t('operations.shiftN', { n: index + 1 })}: {t('operations.pickDriver')}
                        </option>
                        {activeDrivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {t('operations.shiftN', { n: index + 1 })}: {driver.firstName}{' '}
                            {driver.lastName}
                          </option>
                        ))}
                      </select>
                    ))}
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={saveMembers.isPending}
              className="mt-3 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              onClick={() => void onSaveMembers()}
            >
              {t('operations.saveMembers')}
            </button>
          </div>
        )}

        {cycles.data && (
          <div className="mt-6 flex flex-col gap-4" data-testid="haul-results">
            <p className="text-sm text-slate-700">
              {t('operations.services')}: {cycles.data.services} · {t('operations.colDistance')}:{' '}
              {cycles.data.distanceKm} km
              {cycles.data.truncated ? ` · ${t('operations.truncated')}` : ''}
            </p>
            <div className="overflow-x-auto" data-testid="haul-by-shift">
              <h3 className="text-sm font-semibold">{t('operations.byShift')}</h3>
              <table className="mt-2 w-full text-sm">
                <thead className="text-start text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t('operations.colShift')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.services')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colDistance')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colLoad')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colHours')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colTrucks')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colDrivers')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colWithoutDriver')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(cycles.data.byShift ?? []).map((row) => (
                    <tr key={row.shift} className="border-t border-slate-100">
                      <td className="px-2 py-2">{shiftLabel(row)}</td>
                      <td className="px-2 py-2">{row.services}</td>
                      <td className="px-2 py-2">{row.distanceKm}</td>
                      <td className="px-2 py-2">{hours(row.loadDwellSec)}</td>
                      <td className="px-2 py-2">{hours(row.durationSec)}</td>
                      <td className="px-2 py-2">{row.trucks}</td>
                      <td className="px-2 py-2">{row.drivers}</td>
                      <td className={`px-2 py-2 ${row.withoutDriver > 0 ? 'text-amber-800' : ''}`}>
                        {row.withoutDriver}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CycleTable title={t('operations.byVehicle')} rows={cycles.data.byVehicle} />
            <div className="overflow-x-auto">
              <h3 className="text-sm font-semibold">{t('operations.byDriver')}</h3>
              <table className="mt-2 w-full text-sm">
                <thead className="text-start text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t('operations.colDriver')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colShift')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colVehicles')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.services')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colDistance')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colHours')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.data.byDriverShift.map((row) => (
                    <tr key={`${row.driverId}-${row.shift}`} className="border-t border-slate-100">
                      <td className="px-2 py-2">{row.driverName}</td>
                      <td className="px-2 py-2">{shiftLabel(row)}</td>
                      <td className="px-2 py-2">{(row.vehicleNames ?? []).join('، ')}</td>
                      <td className="px-2 py-2">{row.services}</td>
                      <td className="px-2 py-2">{row.distanceKm}</td>
                      <td className="px-2 py-2">{hours(row.durationSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="text-sm font-semibold">{t('operations.byShovel')}</h3>
              <table className="mt-2 w-full text-sm">
                <thead className="text-start text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t('operations.colShovel')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.loads')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.data.byShovel.map((row) => (
                    <tr key={row.shovelId} className="border-t border-slate-100">
                      <td className="px-2 py-2 font-mono">{row.shovelLabel}</td>
                      <td className="px-2 py-2">{row.loads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cycles.data.openHauls.length > 0 && (
              <p className="text-sm text-slate-600">
                {t('operations.openHauls')}:{' '}
                {cycles.data.openHauls
                  .map((row) => `${row.vehicleName} (${stamp(row.since)})`)
                  .join('، ')}
              </p>
            )}
            {cycles.data.unbound.length > 0 && (
              <p className="text-sm text-amber-800">
                {t('operations.unboundMembers')}:{' '}
                {cycles.data.unbound.map((row) => row.imei ?? row.deviceId).join('، ')}
              </p>
            )}
            <div className="overflow-x-auto">
              <h3 className="text-sm font-semibold">{t('operations.cycles')}</h3>
              <table className="mt-2 w-full text-sm">
                <thead className="text-start text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t('operations.colTime')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colVehicle')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colDriver')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colShovel')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colShift')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colLoad')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colTravel')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colDistance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.data.cycles.map((row) => (
                    <tr
                      key={`${row.vehicleId}-${row.originEnteredAt}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-2 py-2">{stamp(row.originEnteredAt)}</td>
                      <td className="px-2 py-2">{row.vehicleName}</td>
                      <td className="px-2 py-2">
                        {row.driverName ?? '—'}
                        {row.driverSource === 'ASSIGNMENT' && (
                          <span className="ms-1 text-xs text-slate-500">
                            ({t('operations.fromAssignment')})
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">{row.shovelLabel ?? '—'}</td>
                      <td className="px-2 py-2">{shiftLabel(row)}</td>
                      <td className="px-2 py-2">{hours(row.loadDwellSec)}</td>
                      <td className="px-2 py-2">{hours(row.travelSec)}</td>
                      <td className="px-2 py-2">{row.distanceKm}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

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

function ShiftPlanNote({
  startHour,
  durationHours,
  count,
  tooLong,
}: {
  startHour: number;
  durationHours: number;
  count: number;
  tooLong: boolean;
}) {
  const { t } = useTranslation();
  if (tooLong) {
    return <p className="text-sm text-red-700 sm:col-span-2">{t('operations.shiftTooLong')}</p>;
  }
  return (
    <p className="text-sm text-slate-600 sm:col-span-2" data-testid="shift-plan">
      {t('operations.shiftPlan')}:{' '}
      {shiftPlan(startHour, durationHours, count)
        .map((shift) => `${t('operations.shiftN', { n: shift.no })} ${shift.from}–${shift.to}`)
        .join(' · ')}
    </p>
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
  const [start, setStart] = useState(route.shiftStartHour);
  const [duration, setDuration] = useState(route.shiftDurationHours);
  const [count, setCount] = useState(route.shiftCount ?? 1);
  const tooLong = count * duration > 24;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (tooLong) {
      onError(t('operations.shiftTooLong'));
      return;
    }
    try {
      await update.mutateAsync({
        name: name.trim(),
        shiftStartHour: start,
        shiftDurationHours: duration,
        shiftCount: count,
      });
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('operations.saveFailed'));
    }
  };

  return (
    <form
      data-testid="haul-route-settings"
      onSubmit={onSubmit}
      className="mt-4 grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2"
    >
      <h3 className="text-sm font-semibold sm:col-span-2">{t('operations.routeSettings')}</h3>
      <label className="text-sm font-medium">
        {t('operations.routeName')}
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={200}
        />
      </label>
      <label className="text-sm font-medium">
        {t('operations.shiftStart')}
        <input
          type="number"
          min={0}
          max={23}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={start}
          onChange={(event) => setStart(Number(event.target.value))}
        />
      </label>
      <label className="text-sm font-medium">
        {t('operations.shiftDuration')}
        <input
          type="number"
          min={1}
          max={24}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
        />
      </label>
      <label className="text-sm font-medium">
        {t('operations.shiftCount')}
        <input
          type="number"
          min={1}
          max={maxShifts(duration)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        />
      </label>
      <ShiftPlanNote startHour={start} durationHours={duration} count={count} tooLong={tooLong} />
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={update.isPending}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {t('operations.saveRoute')}
        </button>
        <button
          type="button"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-200"
          onClick={onArchive}
        >
          {t('operations.archiveRoute')}
        </button>
      </div>
    </form>
  );
}

function CycleTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    vehicleId: string;
    vehicleName: string;
    services: number;
    distanceKm: number;
    durationSec: number;
  }>;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <table className="mt-2 w-full text-sm">
        <thead className="text-start text-slate-500">
          <tr>
            <th className="px-2 py-2 font-medium">{t('operations.colVehicle')}</th>
            <th className="px-2 py-2 font-medium">{t('operations.services')}</th>
            <th className="px-2 py-2 font-medium">{t('operations.colDistance')}</th>
            <th className="px-2 py-2 font-medium">{t('operations.colHours')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.vehicleId} className="border-t border-slate-100">
              <td className="px-2 py-2">{row.vehicleName}</td>
              <td className="px-2 py-2">{row.services}</td>
              <td className="px-2 py-2">{row.distanceKm}</td>
              <td className="px-2 py-2">{hours(row.durationSec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

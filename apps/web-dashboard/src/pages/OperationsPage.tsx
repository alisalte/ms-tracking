/**
 * Mine operations (`/operations`).
 *
 * Device activity answers when a machine started sending positions, how much
 * data arrived, how long it was offline, and how far it travelled. A haul
 * route names an origin, a destination, a shift, and the trucks and shovels
 * on that service. Each origin → destination pass is one service for the
 * truck, its driver, and the shovel that was loading.
 */
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDevices } from '@/api/asset.api';
import { useGeofences } from '@/api/geofence.api';
import {
  type ReportPreset,
  useCreateHaulRoute,
  useDeviceActivity,
  useHaulCycles,
  useHaulMembers,
  useHaulRoutes,
  useSetHaulMembers,
} from '@/api/operations.api';
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

export function OperationsPage() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<ReportPreset>('today');
  const [routeId, setRouteId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [shiftStart, setShiftStart] = useState(6);
  const [shiftHours, setShiftHours] = useState(12);
  const [roles, setRoles] = useState<Record<string, '' | 'TRUCK' | 'SHOVEL'>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const activity = useDeviceActivity(preset);
  const routes = useHaulRoutes();
  const geofences = useGeofences();
  const devices = useDevices();
  const members = useHaulMembers(routeId);
  const cycles = useHaulCycles(routeId, preset);
  const createRoute = useCreateHaulRoute();
  const saveMembers = useSetHaulMembers(routeId);

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
  }, [members.data]);

  const places = (geofences.data ?? []).filter((place) => place.status !== 'ARCHIVED');
  const units = (devices.data ?? []).filter((device) => device.status !== 'DECOMMISSIONED');

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      const created = await createRoute.mutateAsync({
        name: name.trim(),
        originGeofenceId: originId,
        destinationGeofenceId: destinationId,
        shiftStartHour: shiftStart,
        shiftDurationHours: shiftHours,
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
    const assigned = Object.entries(roles)
      .filter(
        (entry): entry is [string, 'TRUCK' | 'SHOVEL'] =>
          entry[1] === 'TRUCK' || entry[1] === 'SHOVEL',
      )
      .map(([deviceId, role]) => ({ deviceId, role }));
    try {
      await saveMembers.mutateAsync(assigned);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('operations.saveFailed'));
    }
  };

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
          <button
            type="submit"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white sm:col-span-2 sm:w-fit"
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
            onChange={(event) => setRouteId(event.target.value || null)}
          >
            <option value="">{t('operations.pickRoute')}</option>
            {(routes.data ?? []).map((route) => (
              <option key={route.id} value={route.id}>
                {route.name}
              </option>
            ))}
          </select>
        </label>

        {routeId && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">{t('operations.members')}</h3>
            <p className="mt-1 text-sm text-slate-600">{t('operations.membersHint')}</p>
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
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-3 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white"
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
            <CycleTable title={t('operations.byVehicle')} rows={cycles.data.byVehicle} />
            <div>
              <h3 className="text-sm font-semibold">{t('operations.byDriver')}</h3>
              <table className="mt-2 w-full text-sm">
                <thead className="text-start text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t('operations.colDriver')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colShift')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.services')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colDistance')}</th>
                    <th className="px-2 py-2 font-medium">{t('operations.colHours')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.data.byDriverShift.map((row) => (
                    <tr key={`${row.driverId}-${row.shift}`} className="border-t border-slate-100">
                      <td className="px-2 py-2">{row.driverName}</td>
                      <td className="px-2 py-2">
                        {row.shift === 'off-shift' ? t('operations.offShift') : row.shift}
                      </td>
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
                {cycles.data.openHauls.map((row) => row.vehicleName).join('، ')}
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
                      <td className="px-2 py-2">{row.vehicleName}</td>
                      <td className="px-2 py-2">{row.driverName ?? '—'}</td>
                      <td className="px-2 py-2">{row.shovelLabel ?? '—'}</td>
                      <td className="px-2 py-2">
                        {row.shift === 'off-shift' ? t('operations.offShift') : row.shift}
                      </td>
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
    </div>
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

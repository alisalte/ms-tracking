/**
 * Shared pieces of the fleet-wide tabular reports (high speeds, mileage,
 * temperature): the fleet / vehicle scope picker, the Excel button, the
 * on-demand address cell and the legacy-style duration wording.
 */
import { Download, MapPin } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useFleets, useVehicles } from '@/api/asset.api';
import { useReverseGeocode } from '@/api/map.api';
import type { FleetScope } from '@/api/report.api';
import { Card } from '@/components/tailwind-ui';

const FIELD =
  'h-9 rounded-lg border border-gray-300 bg-transparent px-2 text-sm dark:border-white/10 dark:bg-graydark-300';

/** Fleet + vehicle pickers, report-specific controls, and the Excel download. */
export function FleetReportToolbar({
  scope,
  onScope,
  children,
  onExport,
  testid,
}: {
  scope: FleetScope;
  onScope: (s: FleetScope) => void;
  children?: ReactNode;
  onExport: () => Promise<void>;
  testid: string;
}) {
  const { t } = useTranslation();
  const fleets = useFleets();
  const vehiclesQ = useVehicles();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const vehicles = useMemo(
    () =>
      (vehiclesQ.data ?? [])
        .filter((v) => !scope.fleetId || v.fleetId === scope.fleetId)
        .map((v) => ({
          id: v.id,
          label: v.plate && v.plate !== v.name ? `${v.name} · ${v.plate}` : v.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [vehiclesQ.data, scope.fleetId],
  );

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 p-4" data-testid={testid}>
        <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-graydark-700">
          {t('reports.cols.fleet')}
          <select
            className={`${FIELD} min-w-40`}
            value={scope.fleetId ?? ''}
            onChange={(e) => onScope({ fleetId: e.target.value || undefined })}
          >
            <option value="">{t('reports.fleet.allFleets')}</option>
            {(fleets.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-graydark-700">
          {t('reports.cols.vehicle')}
          <select
            className={`${FIELD} min-w-48`}
            value={scope.vehicleId ?? ''}
            onChange={(e) => onScope({ ...scope, vehicleId: e.target.value || undefined })}
          >
            <option value="">{t('reports.fleet.allVehicles')}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {children}
        <div className="ms-auto flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailed(false);
              try {
                await onExport();
              } catch {
                setFailed(true);
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={14} aria-hidden="true" />
            {busy ? t('common.loading') : t('reports.fleet.exportXlsx')}
          </button>
          {failed && (
            <span role="alert" className="text-xs text-error-600">
              {t('reports.fleet.exportFailed')}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/** A labelled number input that only reports valid values. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  allowEmpty = false,
  width = 'w-24',
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  allowEmpty?: boolean;
  width?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-graydark-700">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') {
            if (allowEmpty) onChange(null);
            return;
          }
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        className={`${FIELD} ${width}`}
      />
    </label>
  );
}

/** `2 ساعت 21 دقیقه 0 ثانیه` — hours, minutes and seconds, like the legacy report. */
export function useHms() {
  const { t } = useTranslation();
  return (sec: number) => {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return h > 0 ? t('reports.fleet.hms', { h, m, s: r }) : t('reports.fleet.ms', { m, s: r });
  };
}

/**
 * Place of a report row. Coordinates and a map link right away; the street
 * address is looked up only when the reader asks for it (geocoding is rationed).
 */
export function PlaceCell({
  lat,
  lng,
  mapUrl,
}: {
  lat: number;
  lng: number;
  mapUrl?: string;
}) {
  const { t } = useTranslation();
  const [ask, setAsk] = useState(false);
  const q = useReverseGeocode(ask ? lat : null, ask ? lng : null);
  return (
    <div className="flex min-w-48 flex-col gap-0.5 text-xs">
      {ask && q.data?.formatted ? (
        <span className="text-gray-800 dark:text-white/90">{q.data.formatted}</span>
      ) : ask && q.isLoading ? (
        <span className="text-gray-500">{t('common.loading')}</span>
      ) : ask ? (
        <span className="text-gray-500">{t('reports.fleet.noAddress')}</span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAsk(true);
          }}
          className="cursor-pointer self-start border-none bg-transparent p-0 text-xs font-semibold text-brand-500"
        >
          {t('reports.fleet.showAddress')}
        </button>
      )}
      <span className="flex items-center gap-2 text-gray-500 dark:text-graydark-600" dir="ltr">
        {lat.toFixed(5)}, {lng.toFixed(5)}
        {mapUrl && (
          <Link
            to={mapUrl}
            className="inline-flex items-center text-brand-500"
            aria-label={t('reports.viewOnMap')}
            title={t('reports.viewOnMap')}
          >
            <MapPin size={13} aria-hidden="true" />
          </Link>
        )}
      </span>
    </div>
  );
}

/** The app's map in history mode on one vehicle, padded around a period. */
export function historyMapUrl(vehicleId: string, from: string, to: string, padMs = 120_000) {
  const f = new Date(Date.parse(from) - padMs).toISOString();
  const tt = new Date(Date.parse(to) + padMs).toISOString();
  return `/map?vehicle=${encodeURIComponent(vehicleId)}&from=${encodeURIComponent(f)}&to=${encodeURIComponent(tt)}`;
}

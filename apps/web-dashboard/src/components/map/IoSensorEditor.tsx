import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSaveIoSensors } from '@/api/fleet.api';
import type {
  FmbIoPanel,
  IoCalibrationPoint,
  IoSensorConfig,
  IoSensorInput,
  IoSensorKind,
} from '@/types/fleet.types';

const INPUTS: readonly IoSensorInput[] = ['ain1', 'ain2', 'ain3', 'ain4'];

interface Draft {
  input: IoSensorInput;
  kind: IoSensorKind;
  label: string;
  tankLiters: string;
  points: Array<{ v: string; value: string }>;
}

function defaultPoints(kind: IoSensorKind): Draft['points'] {
  if (kind === 'fuel') {
    return [
      { v: '', value: '0' },
      { v: '', value: '100' },
    ];
  }
  if (kind === 'temperature') {
    return [
      { v: '', value: '40' },
      { v: '', value: '100' },
    ];
  }
  return [];
}

function toDraft(input: IoSensorInput, s: IoSensorConfig | undefined): Draft {
  if (!s) return { input, kind: 'voltage', label: '', tankLiters: '', points: [] };
  return {
    input,
    kind: s.kind,
    label: s.label ?? '',
    tankLiters: s.tankLiters ? String(s.tankLiters) : '',
    points: s.points.map((p) => ({ v: String(p.v), value: String(p.value) })),
  };
}

const parse = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));

/** Draft → config, or an i18n error key. Voltage-only inputs with no label are dropped. */
function toConfig(d: Draft): IoSensorConfig | null | { error: string } {
  if (d.kind === 'voltage') {
    return d.label.trim()
      ? { input: d.input, kind: 'voltage', label: d.label.trim(), points: [] }
      : null;
  }
  const points: IoCalibrationPoint[] = [];
  for (const p of d.points) {
    const v = parse(p.v);
    const value = parse(p.value);
    if (!Number.isFinite(v) || !Number.isFinite(value) || v < 0 || v > 60) {
      return { error: 'map.io.sensors.errors.point' };
    }
    points.push({ v, value });
  }
  if (points.length < 2) return { error: 'map.io.sensors.errors.twoPoints' };
  if (new Set(points.map((p) => p.v)).size !== points.length) {
    return { error: 'map.io.sensors.errors.sameVoltage' };
  }
  const tank = parse(d.tankLiters);
  return {
    input: d.input,
    kind: d.kind,
    ...(d.label.trim() ? { label: d.label.trim() } : {}),
    ...(d.kind === 'fuel' && Number.isFinite(tank) && tank > 0 ? { tankLiters: tank } : {}),
    points: points.sort((a, b) => a.v - b.v),
  };
}

const inputClass =
  'h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-graydark-800';

/**
 * Which sensor sits on each analog input, and its calibration (volts → % or °C).
 * "Current" copies the live voltage, so calibrating is: empty the tank (or let
 * the engine cool), press Current, fill (or warm up), press Current again.
 */
export function IoSensorEditor({
  vehicleId,
  panel,
  sensors,
  onDone,
}: {
  vehicleId: string;
  panel: FmbIoPanel;
  sensors: readonly IoSensorConfig[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const save = useSaveIoSensors(vehicleId);
  const live = new Map<string, number>();
  for (const p of panel.groups.ain ?? []) {
    if (p.key && typeof p.value === 'number') live.set(p.key, p.value);
  }
  const shown = INPUTS.filter((i) => live.has(i) || sensors.some((s) => s.input === i));
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    shown.map((i) =>
      toDraft(
        i,
        sensors.find((s) => s.input === i),
      ),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, next: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...next } : d)));
  const patchPoint = (i: number, k: number, next: Partial<Draft['points'][number]>) =>
    setDrafts((ds) =>
      ds.map((d, j) =>
        j === i ? { ...d, points: d.points.map((p, m) => (m === k ? { ...p, ...next } : p)) } : d,
      ),
    );

  const submit = async () => {
    const out: IoSensorConfig[] = [];
    for (const d of drafts) {
      const c = toConfig(d);
      if (c && 'error' in c) {
        setError(`${d.input.toUpperCase()}: ${t(c.error)}`);
        return;
      }
      if (c) out.push(c);
    }
    setError(null);
    try {
      await save.mutateAsync(out);
      onDone();
    } catch {
      setError(t('map.io.sensors.errors.save'));
    }
  };

  if (shown.length === 0) {
    return (
      <p className="p-2 text-xs text-gray-500 dark:text-graydark-600">{t('map.io.sensors.none')}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="io-sensor-editor">
      <p className="px-1 text-xs text-gray-500 dark:text-graydark-600">
        {t('map.io.sensors.help')}
      </p>
      {drafts.map((d, i) => {
        const volts = live.get(d.input);
        return (
          <fieldset
            key={d.input}
            className="flex flex-col gap-2 rounded-lg border border-gray-100 p-2.5 dark:border-white/5"
          >
            <legend className="px-1 text-xs font-semibold text-gray-700 dark:text-graydark-800">
              {t(`map.io.points.${d.input}`)}
              {volts !== undefined ? (
                <span dir="ltr" className="ms-1.5 font-normal tabular-nums text-gray-400">
                  ({volts} V)
                </span>
              ) : null}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-graydark-600">
                {t('map.io.sensors.kind')}
                <select
                  className={inputClass}
                  value={d.kind}
                  onChange={(e) => {
                    const kind = e.target.value as IoSensorKind;
                    patch(i, { kind, points: d.points.length ? d.points : defaultPoints(kind) });
                  }}
                >
                  {(['voltage', 'fuel', 'temperature'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`map.io.sensors.kinds.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-graydark-600">
                {t('map.io.sensors.label')}
                <input
                  className={inputClass}
                  value={d.label}
                  maxLength={60}
                  placeholder={t(`map.io.sensors.kinds.${d.kind}`)}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
              </label>
            </div>
            {d.kind === 'fuel' ? (
              <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-graydark-600">
                {t('map.io.sensors.tankLiters')}
                <input
                  className={inputClass}
                  dir="ltr"
                  inputMode="decimal"
                  value={d.tankLiters}
                  onChange={(e) => patch(i, { tankLiters: e.target.value })}
                />
              </label>
            ) : null}
            {d.kind !== 'voltage' ? (
              <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5 text-[0.7rem] text-gray-500 dark:text-graydark-600">
                  <span>{t('map.io.sensors.volts')}</span>
                  <span>
                    {d.kind === 'fuel' ? t('map.io.sensors.percent') : t('map.io.sensors.celsius')}
                  </span>
                </div>
                {d.points.map((p, k) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides position
                    key={k}
                    className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-1.5"
                  >
                    <input
                      className={inputClass}
                      dir="ltr"
                      inputMode="decimal"
                      aria-label={`${t('map.io.sensors.volts')} ${k + 1}`}
                      value={p.v}
                      onChange={(e) => patchPoint(i, k, { v: e.target.value })}
                    />
                    <input
                      className={inputClass}
                      dir="ltr"
                      inputMode="decimal"
                      aria-label={`${d.kind === 'fuel' ? t('map.io.sensors.percent') : t('map.io.sensors.celsius')} ${k + 1}`}
                      value={p.value}
                      onChange={(e) => patchPoint(i, k, { value: e.target.value })}
                    />
                    <button
                      type="button"
                      disabled={volts === undefined}
                      onClick={() => patchPoint(i, k, { v: String(volts) })}
                      className="h-8 rounded-md border border-gray-200 px-2 text-xs text-brand-600 hover:bg-brand-50 disabled:opacity-40 dark:border-white/10 dark:text-brand-400 dark:hover:bg-white/5"
                    >
                      {t('map.io.sensors.useCurrent')}
                    </button>
                    <button
                      type="button"
                      disabled={d.points.length <= 2}
                      onClick={() => patch(i, { points: d.points.filter((_, m) => m !== k) })}
                      aria-label={t('map.io.sensors.removePoint')}
                      className="flex size-8 items-center justify-center rounded-md text-gray-400 hover:text-danger-600 disabled:opacity-30"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={d.points.length >= 20}
                  onClick={() => patch(i, { points: [...d.points, { v: '', value: '' }] })}
                  className="inline-flex items-center gap-1 self-start text-xs text-brand-600 dark:text-brand-400"
                >
                  <Plus size={14} aria-hidden />
                  {t('map.io.sensors.addPoint')}
                </button>
              </div>
            ) : null}
          </fieldset>
        );
      })}
      {error ? (
        <p role="alert" className="px-1 text-xs text-danger-600 dark:text-danger-400">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="h-8 rounded-md px-3 text-sm text-gray-600 hover:bg-gray-100 dark:text-graydark-600 dark:hover:bg-white/5"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={save.isPending}
          className="h-8 rounded-md bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

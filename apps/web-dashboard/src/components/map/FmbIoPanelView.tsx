import type { TFunction } from 'i18next';
import { ChevronDown, LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FmbIoGauges } from '@/components/map/FmbIoGauges';
import { IoSensorEditor } from '@/components/map/IoSensorEditor';
import { buildGaugeView } from '@/lib/io-gauges';
import { lastSeenLabel } from '@/lib/relative-time';
import type { FmbIoGroup, FmbIoPanel, FmbIoPoint, IoSensorConfig } from '@/types/fleet.types';

/** Display order of the groups; a group without points is not drawn. */
const GROUP_ORDER: readonly FmbIoGroup[] = [
  'din',
  'dout',
  'ain',
  'onewire',
  'serial',
  'can',
  'j1708',
  'kline',
  'other',
];

/** Groups whose rows are short on meaning (raw ids) start folded. */
const START_FOLDED: ReadonlySet<FmbIoGroup> = new Set(['other']);

/** Remembered per viewer: whether the whole panel is open. */
const OPEN_STORAGE_KEY = 'fv.fmbIo.open';

const NO_SENSORS: readonly IoSensorConfig[] = [];

/** Remembered per viewer: graphic gauges or the plain list. */
const VIEW_STORAGE_KEY = 'fv.fmbIo.view';

type ViewMode = 'gauges' | 'list';

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'gauges';
  } catch {
    return 'gauges';
  }
}

function writeView(view: ViewMode): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* blocked storage — the view just resets */
  }
}

/** Seconds after which a point is shown as stale (its device time, not receipt). */
const STALE_AFTER_MS = 10 * 60 * 1000;

function isStale(at: string, now: number): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t > STALE_AFTER_MS;
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* private mode / blocked storage — the panel just forgets */
  }
}

/** Technical code under a row's name: DIN1 / AIN2 / DOUT1 for I/O, else the AVL id. */
function codeOf(p: FmbIoPoint): string {
  if (p.key && (p.group === 'din' || p.group === 'dout' || p.group === 'ain')) {
    return p.key.toUpperCase();
  }
  return `AVL ${p.id}`;
}

function PointValue({ point }: { point: FmbIoPoint }) {
  const { t } = useTranslation();
  if (typeof point.value === 'boolean') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-sm font-medium ${
          point.value
            ? 'text-success-600 dark:text-success-400'
            : 'text-gray-500 dark:text-graydark-600'
        }`}
      >
        <span
          aria-hidden
          className={`size-2 rounded-full ${point.value ? 'bg-success-500' : 'bg-gray-300 dark:bg-white/20'}`}
        />
        {point.value ? t('map.io.on') : t('map.io.off')}
      </span>
    );
  }
  const text = point.value === '' ? '—' : String(point.value);
  // dir=ltr keeps "2.475 V" in reading order inside the RTL layout.
  return (
    <span
      dir="ltr"
      className="text-sm font-medium tabular-nums text-gray-800 dark:text-graydark-800"
    >
      {text}
      {point.unit && point.value !== '' ? ` ${point.unit}` : ''}
    </span>
  );
}

/** One-line digest shown while the panel is folded: "1 of 4 inputs on · Analog: 3 · …". */
function summaryOf(panel: FmbIoPanel, groups: readonly FmbIoGroup[], t: TFunction): string {
  return groups
    .map((g) => {
      const points = panel.groups[g] ?? [];
      if (g === 'din' || g === 'dout') {
        const on = points.filter((p) => p.value === true).length;
        return t(`map.io.summary.${g}`, { on, total: points.length });
      }
      return `${t(`map.io.groups.${g}`)}: ${points.length}`;
    })
    .join(' · ');
}

function GroupSection({
  group,
  points,
  now,
}: {
  group: FmbIoGroup;
  points: readonly FmbIoPoint[];
  now: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(!START_FOLDED.has(group));
  const hint = t(`map.io.hints.${group}`, { defaultValue: '' });
  const bodyId = `fmb-io-${group}`;
  return (
    <div className="rounded-lg border border-gray-100 dark:border-white/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-gray-700 dark:text-graydark-800">
            {t(`map.io.groups.${group}`)}
            <span className="ms-1.5 font-normal text-gray-400 dark:text-graydark-600">
              ({points.length})
            </span>
          </span>
          {hint ? (
            <span className="block truncate text-xs text-gray-500 dark:text-graydark-600">
              {hint}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <ul
          id={bodyId}
          className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-white/5 dark:border-white/5"
        >
          {points.map((p) => (
            <li
              key={p.id}
              className={`flex items-center justify-between gap-3 px-3 py-2 ${
                isStale(p.at, now) ? 'opacity-50' : ''
              }`}
              title={new Date(p.at).toLocaleString()}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-gray-700 dark:text-graydark-800">
                  {p.key
                    ? t(`map.io.points.${p.key}`, { defaultValue: t('map.io.unknown') })
                    : t('map.io.unknown')}
                </span>
                <span
                  dir="ltr"
                  className="block text-start text-xs text-gray-400 dark:text-graydark-600"
                >
                  {codeOf(p)}
                </span>
              </span>
              <PointValue point={p} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof List;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ${
        active
          ? 'bg-white text-brand-600 shadow-sm dark:bg-white/10 dark:text-brand-300'
          : 'text-gray-500 hover:text-gray-700 dark:text-graydark-600'
      }`}
    >
      <Icon size={14} aria-hidden />
      {label}
    </button>
  );
}

/**
 * Live I/O of a Teltonika FMB640: digital inputs/outputs, analog inputs,
 * 1-Wire, serial (RS232/RS485) sensors and CAN. Folded by default, with a
 * one-line summary. Opened, it shows gauges (fuel tank, thermometer, dials,
 * lamps) or the plain list; analog inputs become fuel/temperature gauges once
 * the vehicle's sensor wiring is set (`sensors`, editable with `canConfigure`).
 * Values are the newest the device reported; one older than 10 minutes is dimmed.
 */
export function FmbIoPanelView({
  panel,
  vehicleId,
  sensors = NO_SENSORS,
  canConfigure = false,
}: {
  panel: FmbIoPanel;
  vehicleId?: string;
  sensors?: readonly IoSensorConfig[];
  canConfigure?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(readOpen);
  const [view, setView] = useState<ViewMode>(readView);
  const [editing, setEditing] = useState(false);
  const gaugeView = useMemo(() => buildGaugeView(panel, sensors), [panel, sensors]);
  const now = Date.now();
  const groups = GROUP_ORDER.filter((g) => (panel.groups[g]?.length ?? 0) > 0);
  if (groups.length === 0) return null;

  const pick = (v: ViewMode) => {
    setEditing(false);
    setView(v);
    writeView(v);
  };
  const showGauges = view === 'gauges' && gaugeView.sections.length > 0;

  const toggle = () => {
    setOpen((o) => {
      writeOpen(!o);
      return !o;
    });
  };

  return (
    <section
      className="mb-4 rounded-xl border border-gray-200 dark:border-white/10"
      aria-label={t('map.io.title')}
      data-testid="fmb-io-panel"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="fmb-io-body"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-gray-800 dark:text-graydark-800">
            {t('map.io.title')}
          </span>
          <span className="block truncate text-xs text-gray-500 dark:text-graydark-600">
            {open
              ? t('map.io.updated', { time: lastSeenLabel(panel.updatedAt, t) })
              : summaryOf(panel, groups, t)}
          </span>
        </span>
        <ChevronDown
          size={18}
          aria-hidden
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div
          id="fmb-io-body"
          className="flex flex-col gap-2 border-t border-gray-100 p-2 dark:border-white/5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-white/5">
              <ModeButton
                active={view === 'gauges' && !editing}
                onClick={() => pick('gauges')}
                icon={LayoutGrid}
                label={t('map.io.views.gauges')}
              />
              <ModeButton
                active={view === 'list' && !editing}
                onClick={() => pick('list')}
                icon={List}
                label={t('map.io.views.list')}
              />
            </div>
            {canConfigure && vehicleId ? (
              <ModeButton
                active={editing}
                onClick={() => setEditing((e) => !e)}
                icon={SlidersHorizontal}
                label={t('map.io.sensors.title')}
              />
            ) : null}
          </div>
          {editing && vehicleId ? (
            <IoSensorEditor
              vehicleId={vehicleId}
              panel={panel}
              sensors={sensors}
              onDone={() => setEditing(false)}
            />
          ) : showGauges ? (
            <FmbIoGauges view={gaugeView} now={now} />
          ) : (
            groups.map((g) => (
              <GroupSection key={g} group={g} points={panel.groups[g] ?? []} now={now} />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

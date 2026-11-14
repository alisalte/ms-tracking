import { Fuel, Gauge as GaugeIcon, KeyRound, Route } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  DialGauge,
  FuelGauge,
  Gauge,
  GaugeLevel,
  GaugeView,
  SwitchGauge,
  TempGauge,
  ValueGauge,
} from '@/lib/io-gauges';

/** Seconds after which a value is dimmed (device time, not receipt). */
const STALE_AFTER_MS = 10 * 60 * 1000;

function isStale(at: string, now: number): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t > STALE_AFTER_MS;
}

const LEVEL_COLOR: Record<GaugeLevel, string> = {
  normal: 'var(--color-success-500)',
  cold: 'var(--color-info-500)',
  warning: 'var(--color-warning-500)',
  critical: 'var(--color-danger-500)',
};

const LEVEL_TEXT: Record<GaugeLevel, string> = {
  normal: 'text-success-600 dark:text-success-400',
  cold: 'text-info-600 dark:text-info-400',
  warning: 'text-warning-700 dark:text-warning-400',
  critical: 'text-danger-600 dark:text-danger-400',
};

/** Unfilled part of a gauge; set per theme on the gauges container. */
const TRACK = 'var(--gauge-track)';

function useTitle(g: Gauge): string {
  const { t } = useTranslation();
  if (g.label) return g.label;
  return g.titleKey
    ? t(`map.io.points.${g.titleKey}`, { defaultValue: t('map.io.unknown') })
    : t('map.io.unknown');
}

function fmt(n: number, digits = 1): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function Card({
  gauge,
  now,
  children,
}: {
  gauge: Gauge;
  now: number;
  children: React.ReactNode;
}) {
  const title = useTitle(gauge);
  return (
    <figure
      className={`flex flex-col items-center gap-1 rounded-lg border border-gray-100 bg-white px-2 py-2.5 text-center dark:border-white/5 dark:bg-white/[0.02] ${isStale(gauge.at, now) ? 'opacity-50' : ''}`}
      title={new Date(gauge.at).toLocaleString()}
      data-testid={`gauge-${gauge.id}`}
    >
      {children}
      <figcaption className="w-full min-w-0">
        <span className="line-clamp-2 block text-xs leading-tight font-medium text-gray-700 dark:text-graydark-800">
          {title}
        </span>
        <span dir="ltr" className="block text-[0.65rem] text-gray-400 dark:text-graydark-600">
          {gauge.code}
        </span>
      </figcaption>
    </figure>
  );
}

function LevelLabel({ level, kind }: { level: GaugeLevel; kind: 'fuel' | 'temp' }) {
  const { t } = useTranslation();
  if (level === 'normal') return null;
  return (
    <span className={`text-[0.7rem] font-semibold ${LEVEL_TEXT[level]}`}>
      {level === 'critical' ? '▲ ' : level === 'warning' ? '● ' : '▼ '}
      {t(`map.io.gauges.level.${kind}.${level}`)}
    </span>
  );
}

/**
 * Liquid colours (light top → deep bottom). Each tank on a vehicle gets its own
 * hue so several tanks are told apart at a glance; low / critical levels
 * override it with amber / red (and the level is also written in words).
 */
const TANK_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ['#5eead4', '#0d9488'], // teal
  ['#7dd3fc', '#2563eb'], // blue
  ['#c4b5fd', '#7c3aed'], // violet
  ['#67e8f9', '#0891b2'], // cyan
];
const TANK_LEVEL_PALETTE: Partial<Record<GaugeLevel, readonly [string, string]>> = {
  warning: ['#fcd34d', '#f59e0b'],
  critical: ['#fca5a5', '#dc2626'],
};

/** Tank geometry (SVG user units). */
const TANK = { x: 11, top: 13, width: 50, height: 72, bottom: 85 } as const;
/** Two wavelengths (28) wide and slid by one period (56) → seamless loop. */
const WAVE_PATH = 'M5 0 Q12 -3 19 0 T33 0 T47 0 T61 0 T75 0 T89 0 T103 0 T117 0 V90 H5 Z';
const BUBBLES = [
  { cx: 22, r: 1.8, delay: '0s' },
  { cx: 36, r: 1.3, delay: '1.1s' },
  { cx: 49, r: 2.1, delay: '2s' },
] as const;

/** Level shown by the tank: starts empty and fills to `percent` after mount. */
function useFillLevel(percent: number): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(percent));
    return () => cancelAnimationFrame(raf);
  }, [percent]);
  return shown;
}

/** Fuel tank with its level, percent and (with a tank volume) litres. */
function FuelTank({ gauge, now, index }: { gauge: FuelGauge; now: number; index: number }) {
  const shown = useFillLevel(gauge.percent);
  const [light, deep] = TANK_LEVEL_PALETTE[gauge.level] ??
    TANK_PALETTES[index % TANK_PALETTES.length] ?? ['', ''];
  const uid = `tank-${gauge.id.replace(/[^\w-]/g, '')}`;
  const surface = TANK.bottom - (shown / 100) * TANK.height;
  const levelStyle = { transform: `translateY(${surface}px)` };
  const empty = shown <= 0.5;
  return (
    <Card gauge={gauge} now={now}>
      <svg
        viewBox="0 0 72 92"
        width="60"
        height="76"
        role="img"
        aria-label={`${fmt(gauge.percent, 0)}%`}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={`${uid}-liquid`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={light} />
            <stop offset="100%" stopColor={deep} />
          </linearGradient>
          {/* Cylinder shading over glass and liquid. */}
          <linearGradient id={`${uid}-shade`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#000" stopOpacity="0.12" />
            <stop offset="22%" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="45%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.16" />
          </linearGradient>
          <linearGradient id={`${uid}-cap`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={light} />
            <stop offset="100%" stopColor={deep} />
          </linearGradient>
          <clipPath id={`${uid}-body`}>
            <rect x={TANK.x} y={TANK.top} width={TANK.width} height={TANK.height} rx="13" />
          </clipPath>
          {/* Area under the surface, so bubbles never rise above the liquid. */}
          <clipPath id={`${uid}-liquid-area`}>
            <rect className="fv-tank-level" style={levelStyle} x="0" y="0" width="72" height="92" />
          </clipPath>
        </defs>

        {/* critical glow */}
        {gauge.level === 'critical' ? (
          <rect
            className="fv-tank-alert"
            x="4"
            y="6"
            width="64"
            height="86"
            rx="20"
            fill="none"
            stroke={deep}
            strokeWidth="4"
          />
        ) : null}

        {/* filler cap and neck */}
        <rect x="27" y="3" width="18" height="7" rx="3" fill={`url(#${uid}-cap)`} />
        <rect x="31" y="8" width="10" height="4" fill={TRACK} />

        {/* glass body */}
        <rect x="8" y="10" width="56" height="78" rx="16" fill={TRACK} />
        <rect
          x={TANK.x}
          y={TANK.top}
          width={TANK.width}
          height={TANK.height}
          rx="13"
          className="fill-white dark:fill-white/5"
          fillOpacity="0.85"
        />

        {/* liquid: back wave, front wave, bubbles */}
        <g clipPath={`url(#${uid}-body)`} opacity={empty ? 0 : 1}>
          <g className="fv-tank-level" style={levelStyle}>
            <g className="fv-tank-wave fv-tank-wave--back">
              <path d={WAVE_PATH} fill={deep} fillOpacity="0.45" transform="translate(0 -1.5)" />
            </g>
            <g className="fv-tank-wave">
              <path d={WAVE_PATH} fill={`url(#${uid}-liquid)`} />
            </g>
          </g>
          {shown > 12 ? (
            <g clipPath={`url(#${uid}-liquid-area)`}>
              {BUBBLES.map((b) => (
                <circle
                  key={b.cx}
                  className="fv-tank-bubble"
                  style={{ animationDelay: b.delay }}
                  cx={b.cx}
                  cy={TANK.bottom - 3}
                  r={b.r}
                  fill="#fff"
                  fillOpacity="0.75"
                />
              ))}
            </g>
          ) : null}
        </g>

        {/* glass shading and highlight */}
        <rect
          x={TANK.x}
          y={TANK.top}
          width={TANK.width}
          height={TANK.height}
          rx="13"
          fill={`url(#${uid}-shade)`}
          pointerEvents="none"
        />
        <rect x="16" y="20" width="4" height="50" rx="2" fill="#fff" fillOpacity="0.45" />

        {/* quarter marks */}
        {[0.25, 0.5, 0.75].map((q) => {
          const y = TANK.bottom - q * TANK.height;
          return (
            <line
              key={q}
              x1={q === 0.5 ? 48 : 52}
              x2="58"
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="text-gray-600 dark:text-white"
            />
          );
        })}
      </svg>
      <span
        dir="ltr"
        className="text-lg font-semibold tabular-nums text-gray-800 dark:text-graydark-800"
      >
        {fmt(gauge.percent, 0)}%
      </span>
      {gauge.liters !== null ? (
        <span dir="ltr" className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
          ≈ {fmt(gauge.liters, 0)} L
        </span>
      ) : null}
      <LevelLabel level={gauge.level} kind="fuel" />
      {gauge.volts !== null ? (
        <span dir="ltr" className="text-[0.65rem] tabular-nums text-gray-400">
          {fmt(gauge.volts, 2)} V
        </span>
      ) : null}
    </Card>
  );
}

/**
 * Colour of an ambient probe by the temperature itself (°C → colour), so a
 * fridge reads icy at -18 °C and warm at +20 °C whatever its scale.
 */
const THERMAL_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [-20, [139, 92, 246]], // violet
  [0, [59, 130, 246]], // blue
  [8, [6, 182, 212]], // cyan
  [18, [16, 185, 129]], // emerald
  [28, [245, 158, 11]], // amber
  [40, [249, 115, 22]], // orange
  [60, [239, 68, 68]], // red
];

function thermalColor(celsius: number): string {
  const stops = THERMAL_STOPS;
  const first = stops[0] as (typeof stops)[number];
  const last = stops[stops.length - 1] as (typeof stops)[number];
  let rgb: readonly [number, number, number] = celsius <= first[0] ? first[1] : last[1];
  for (let i = 1; i < stops.length; i++) {
    const [ta, ca] = stops[i - 1] as (typeof stops)[number];
    const [tb, cb] = stops[i] as (typeof stops)[number];
    if (celsius >= ta && celsius <= tb) {
      const t = (celsius - ta) / (tb - ta);
      const mix = (a: number, b: number) => Math.round(a + t * (b - a));
      rgb = [mix(ca[0], cb[0]), mix(ca[1], cb[1]), mix(ca[2], cb[2])];
      break;
    }
  }
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

/** Thermometer geometry (SVG user units). */
const THERMO = { tubeX: 23, colX: 26.5, colW: 7, top: 10, bottom: 64, bulbY: 76 } as const;

/** Glass thermometer filled to the temperature on its scale. */
function Thermometer({ gauge, now }: { gauge: TempGauge; now: number }) {
  const span = gauge.max - gauge.min || 1;
  const frac = Math.min(1, Math.max(0, (gauge.celsius - gauge.min) / span));
  const shown = useFillLevel(frac * 100) / 100;
  const color =
    gauge.scale === 'ambient' && gauge.level === 'normal'
      ? thermalColor(gauge.celsius)
      : LEVEL_COLOR[gauge.level];
  const uid = `thermo-${gauge.id.replace(/[^\w-]/g, '')}`;
  const surface = THERMO.bottom - shown * (THERMO.bottom - THERMO.top);
  const levelStyle = { transform: `translateY(${surface}px)` };
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <Card gauge={gauge} now={now}>
      <svg
        viewBox="0 0 64 92"
        width="58"
        height="76"
        role="img"
        aria-label={`${fmt(gauge.celsius)} °C`}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={`${uid}-liquid`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} />
            <stop offset="40%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="55%" stopColor={color} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <radialGradient id={`${uid}-bulb`} cx="38%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="35%" stopColor={color} />
            <stop offset="100%" stopColor={color} />
          </radialGradient>
          <clipPath id={`${uid}-column`}>
            <rect
              x={THERMO.colX}
              y={THERMO.top - 4}
              width={THERMO.colW}
              height={THERMO.bulbY - THERMO.top + 4}
              rx={THERMO.colW / 2}
            />
          </clipPath>
        </defs>

        {/* glow behind the bulb */}
        <circle
          className="fv-thermo-glow"
          cx="30"
          cy={THERMO.bulbY}
          r="15"
          fill={color}
          fillOpacity="0.25"
        />

        {/* glass tube and bulb */}
        <rect x={THERMO.tubeX} y="2" width="14" height="74" rx="7" fill={TRACK} />
        <circle cx="30" cy={THERMO.bulbY} r="12" fill={TRACK} />
        <rect
          x={THERMO.colX - 1}
          y="5"
          width={THERMO.colW + 2}
          height="70"
          rx="4.5"
          className="fill-white dark:fill-white/5"
          fillOpacity="0.85"
        />

        {/* liquid column with a sheen travelling up */}
        <g clipPath={`url(#${uid}-column)`}>
          <g className="fv-tank-level" style={levelStyle}>
            <rect
              x={THERMO.colX}
              y="0"
              width={THERMO.colW}
              height="90"
              fill={`url(#${uid}-liquid)`}
            />
            <rect
              className="fv-thermo-sheen"
              x={THERMO.colX}
              y="40"
              width={THERMO.colW}
              height="10"
              fill="#fff"
              fillOpacity="0.45"
            />
          </g>
        </g>
        <circle cx="30" cy={THERMO.bulbY} r="8.5" fill={`url(#${uid}-bulb)`} />

        {/* glass highlight */}
        <rect
          x={THERMO.tubeX + 2.5}
          y="8"
          width="2"
          height="56"
          rx="1"
          fill="#fff"
          fillOpacity="0.5"
        />

        {/* scale */}
        {ticks.map((q) => {
          const ty = THERMO.bottom - q * (THERMO.bottom - THERMO.top);
          const major = q === 0 || q === 0.5 || q === 1;
          return (
            <g key={q}>
              <line
                x1="40"
                x2={major ? 45 : 43}
                y1={ty}
                y2={ty}
                stroke="currentColor"
                strokeOpacity="0.45"
                strokeLinecap="round"
                className="text-gray-500 dark:text-white"
              />
              {major ? (
                <text
                  x="47"
                  y={ty + 2.5}
                  fontSize="7"
                  fill="currentColor"
                  className="text-gray-400"
                >
                  {Math.round(gauge.min + q * span)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <span
        dir="ltr"
        className="text-lg font-semibold tabular-nums text-gray-800 dark:text-graydark-800"
      >
        {fmt(gauge.celsius)} °C
      </span>
      <LevelLabel level={gauge.level} kind="temp" />
      {gauge.volts !== null ? (
        <span dir="ltr" className="text-[0.65rem] tabular-nums text-gray-400">
          {fmt(gauge.volts, 2)} V
        </span>
      ) : null}
    </Card>
  );
}

/** Half-circle dial (RPM, speed, pedal, raw voltage). */
function Dial({ gauge, now }: { gauge: DialGauge; now: number }) {
  const r = 30;
  const cx = 40;
  const cy = 40;
  const frac = Math.min(1, Math.max(0, (gauge.value - gauge.min) / (gauge.max - gauge.min)));
  const arcLen = Math.PI * r;
  const angle = Math.PI * (1 - frac); // left (π) → right (0)
  const nx = cx + (r - 8) * Math.cos(angle);
  const ny = cy - (r - 8) * Math.sin(angle);
  const path = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <Card gauge={gauge} now={now}>
      <svg
        viewBox="0 0 80 50"
        width="88"
        height="55"
        role="img"
        aria-label={`${fmt(gauge.value, 2)} ${gauge.unit}`}
      >
        <path d={path} fill="none" stroke={TRACK} strokeWidth="7" strokeLinecap="round" />
        <path
          d={path}
          fill="none"
          stroke="var(--color-brand-500)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${frac * arcLen} ${arcLen}`}
          style={{ transition: 'stroke-dasharray 600ms ease' }}
        />
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-gray-700 dark:text-graydark-800"
        />
        <circle
          cx={cx}
          cy={cy}
          r="3"
          fill="currentColor"
          className="text-gray-700 dark:text-graydark-800"
        />
        <text
          x={cx - r}
          y={cy + 9}
          fontSize="7"
          textAnchor="middle"
          fill="currentColor"
          className="text-gray-400"
        >
          {gauge.min}
        </text>
        <text
          x={cx + r}
          y={cy + 9}
          fontSize="7"
          textAnchor="middle"
          fill="currentColor"
          className="text-gray-400"
        >
          {fmt(gauge.max, 0)}
        </text>
      </svg>
      <span
        dir="ltr"
        className="text-base font-semibold tabular-nums text-gray-800 dark:text-graydark-800"
      >
        {fmt(gauge.value, gauge.unit === 'V' ? 2 : 0)}{' '}
        <span className="text-xs font-medium text-gray-500 dark:text-graydark-600">
          {gauge.unit}
        </span>
      </span>
    </Card>
  );
}

/** Digital input/output as a lamp with its state in words. */
function SwitchLamp({ gauge, now }: { gauge: SwitchGauge; now: number }) {
  const { t } = useTranslation();
  return (
    <Card gauge={gauge} now={now}>
      <span
        aria-hidden
        className={`mt-0.5 flex size-8 items-center justify-center rounded-full border-2 ${
          gauge.on
            ? 'border-success-500 bg-success-500 shadow-[0_0_10px_var(--color-success-400)]'
            : 'border-gray-300 bg-gray-100 dark:border-white/20 dark:bg-white/5'
        }`}
      >
        <span
          className={`size-2.5 rounded-full ${gauge.on ? 'bg-white' : 'bg-gray-300 dark:bg-white/20'}`}
        />
      </span>
      <span
        className={`text-sm font-semibold ${
          gauge.on
            ? 'text-success-600 dark:text-success-400'
            : 'text-gray-500 dark:text-graydark-600'
        }`}
      >
        {gauge.on ? t('map.io.on') : t('map.io.off')}
      </span>
    </Card>
  );
}

const VALUE_ICON = { fuel: Fuel, key: KeyRound, odometer: Route, generic: GaugeIcon } as const;

function ValueTile({ gauge, now }: { gauge: ValueGauge; now: number }) {
  const Icon = VALUE_ICON[gauge.icon];
  return (
    <Card gauge={gauge} now={now}>
      <span className="flex size-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
        <Icon size={16} aria-hidden />
      </span>
      <span
        dir="ltr"
        className="max-w-full truncate text-sm font-semibold tabular-nums text-gray-800 dark:text-graydark-800"
      >
        {gauge.text}
        {gauge.unit && gauge.text !== '—' ? ` ${gauge.unit}` : ''}
      </span>
    </Card>
  );
}

function GaugeItem({ gauge, now, index }: { gauge: Gauge; now: number; index: number }) {
  switch (gauge.type) {
    case 'fuel':
      return <FuelTank gauge={gauge} now={now} index={index} />;
    case 'temp':
      return <Thermometer gauge={gauge} now={now} />;
    case 'dial':
      return <Dial gauge={gauge} now={now} />;
    case 'switch':
      return <SwitchLamp gauge={gauge} now={now} />;
    default:
      return <ValueTile gauge={gauge} now={now} />;
  }
}

/** Graphic view of the I/O panel: fuel tanks, thermometers, dials, lamps. */
export function FmbIoGauges({ view, now }: { view: GaugeView; now: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col gap-3 [--gauge-track:var(--color-gray-200)] dark:[--gauge-track:rgba(255,255,255,0.12)]"
      data-testid="fmb-io-gauges"
    >
      {view.sections.map(({ section, gauges }) => (
        <section key={section} aria-label={t(`map.io.gauges.sections.${section}`)}>
          <p className="mb-1.5 px-1 text-xs font-semibold text-gray-500 dark:text-graydark-600">
            {t(`map.io.gauges.sections.${section}`)}
          </p>
          <div className={`grid gap-2 ${section === 'switch' ? 'grid-cols-4' : 'grid-cols-3'}`}>
            {gauges.map((g, i) => (
              <GaugeItem key={g.id} gauge={g} now={now} index={i} />
            ))}
          </div>
        </section>
      ))}
      {view.hidden > 0 ? (
        <p className="px-1 text-xs text-gray-500 dark:text-graydark-600">
          {t('map.io.gauges.hidden', { count: view.hidden })}
        </p>
      ) : null}
    </div>
  );
}

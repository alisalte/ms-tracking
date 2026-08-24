import type { ReactNode } from 'react';

/**
 * SegmentedControl — the one toggle-between-few-modes primitive (TailAdmin /
 * Tremor idiom). Replaces the six hand-rolled chip-row + segmented patterns
 * that had drifted across TrendChartsRow, TripsPage, TripTimeline,
 * ReportsPage, MfaVerifyPage and the Alarm/Event centers.
 *
 * WAI-ARIA radiogroup semantics: arrow keys move between segments (logical —
 * ArrowLeft/Right work in both directions, RTL users get the mirrored order
 * for free because the segments are laid out with logical flex order),
 * Home/End jump to the edges, and the control is tabbable as a single stop.
 *
 * `tone="onGlass"` matches the dark-glass map panels (white-on-dark segments);
 * the default tone follows the app's light/dark surfaces.
 */
export interface SegmentedOption<T extends string | number> {
  value: T;
  /** Visible label (already translated). */
  label: ReactNode;
  icon?: ReactNode;
  /** Visually disables this segment (still focusable for a11y). */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group (required). */
  'aria-label': string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'onGlass';
  className?: string;
}

const TRACK: Record<'default' | 'onGlass', string> = {
  default: 'bg-gray-100 dark:bg-white/5',
  onGlass: 'bg-white/10',
};

const SEGMENT: Record<'default' | 'onGlass', string> = {
  default: 'text-gray-500 hover:text-gray-800 dark:text-graydark-600 dark:hover:text-white',
  onGlass: 'text-white/65 hover:text-white',
};

const SEGMENT_ACTIVE: Record<'default' | 'onGlass', string> = {
  default:
    'bg-white text-gray-900 shadow-sm ring-1 ring-black/2.5 dark:bg-white/15 dark:text-white dark:ring-white/10',
  onGlass: 'bg-white/20 text-white ring-1 ring-white/15',
};

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  size = 'md',
  tone = 'default',
  className = '',
}: SegmentedControlProps<T>) {
  const activeIndex = options.findIndex((o) => o.value === value);

  const move = (from: number, delta: 1 | -1) => {
    // Skip disabled segments; wrap around the group.
    for (let step = 1; step <= options.length; step += 1) {
      const next = (from + delta * step + options.length * 2) % options.length;
      if (!options[next].disabled) {
        onChange(options[next].value);
        return;
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const current = options.findIndex((o) => o.value === value);
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        move(current, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        move(current, -1);
        break;
      case 'Home':
        onChange(options[0].value);
        break;
      case 'End':
        onChange(options[options.length - 1].value);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg p-0.5 ${TRACK[tone]} ${className}`}
      data-testid="segmented-control"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA radiogroup pattern — a native radio cannot render the segmented pill styling.
            role="radio"
            aria-checked={active}
            tabIndex={active || activeIndex === -1 ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={[
              'inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs sm:text-sm',
              active ? SEGMENT_ACTIVE[tone] : SEGMENT[tone],
              option.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {option.icon && <span className="shrink-0 [&_svg]:size-3.5">{option.icon}</span>}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

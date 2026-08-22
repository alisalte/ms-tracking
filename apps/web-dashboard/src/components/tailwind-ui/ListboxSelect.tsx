import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * ListboxSelect / MultiSelect — TailAdmin listbox comboboxes (Phase 2.5).
 *
 * Replaces the last MUI `<Select>`s (map history presets, geofence form).
 * Built as real WAI-ARIA 1.2 combobox+listbox widgets (NOT native `<select>`)
 * because the Playwright e2e suite opens them with a real click and picks
 * `role="option"` entries — a gesture native selects don't support in a real
 * browser. Keyboard: Enter/Space/ArrowDown opens, ↑/↓ moves the active option,
 * Enter selects, Escape closes.
 *
 * Shared surface styling mirrors `Select` (h-9, rounded-lg, brand focus ring);
 * the popover mirrors `Dropdown` (rounded-lg bordered card, z-50).
 */

export interface ListboxOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/** Shared open-popover chrome + outside-press/ESC close behavior. */
function usePopover(open: boolean, onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);
  return rootRef;
}

const POPOVER =
  'absolute z-50 mt-1.5 max-h-60 w-full min-w-44 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-graydark-300';
const OPTION =
  'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-start text-sm text-gray-700 transition-colors hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-graydark-700 dark:hover:bg-white/5 dark:focus:bg-white/5';
const TRIGGER_BASE =
  'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 transition-colors focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-graydark-300 dark:text-white';

// ── Single-select ────────────────────────────────────────────────────────────

export interface ListboxSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly ListboxOption[];
  /** Field label above the control (mirrors Select). */
  label?: ReactNode;
  placeholder?: ReactNode;
  disabled?: boolean;
  className?: string;
  wrapperClassName?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function ListboxSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  disabled = false,
  className = '',
  wrapperClassName = '',
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: ListboxSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const rootRef = usePopover(open, () => setOpen(false));

  const enabled = options
    .map((o, i) => ({ option: o, index: i }))
    .filter(({ option }) => !option.disabled);
  const selected = options.find((o) => o.value === value);
  const activeValue = enabled[Math.min(activeIndex, enabled.length - 1)]?.option.value;

  const openMenu = () => {
    if (disabled) return;
    const current = enabled.findIndex(({ option }) => option.value === value);
    setActiveIndex(current >= 0 ? current : 0);
    setOpen(true);
  };

  const select = (option: ListboxOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openMenu();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const pos = enabled.findIndex(({ option }) => option.value === activeValue);
      const next = enabled[Math.max(0, Math.min(enabled.length - 1, pos + dir))];
      if (next) setActiveIndex(next.index);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      const current = enabled.find(({ option }) => option.value === activeValue);
      if (current) select(current.option);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    } else if ((e.key === 'Enter' || e.key === ' ') && !open) {
      e.preventDefault();
      openMenu();
    }
  };

  return (
    <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
      {label && (
        <span
          id={`${listboxId}-label`}
          className="text-sm font-medium text-gray-700 dark:text-graydark-800"
        >
          {label}
        </span>
      )}
      <div ref={rootRef} className={`relative ${className}`}>
        <button
          type="button"
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA 1.2 combobox pattern — a native <select> cannot render the custom TailAdmin listbox.
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-labelledby={label ? `${listboxId}-label` : undefined}
          aria-label={ariaLabel}
          data-testid={dataTestId}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={onKeyDown}
          className={TRIGGER_BASE}
        >
          <span
            className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-gray-400 dark:text-graydark-600'}`}
          >
            {selected ? selected.label : (placeholder ?? '—')}
          </span>
          <ChevronDown
            size={15}
            aria-hidden
            className={`shrink-0 text-gray-400 transition-transform rtl:rotate-180 dark:text-graydark-600 ${open ? 'rotate-180 rtl:-rotate-180' : ''}`}
          />
        </button>
        {open && (
          <ul
            id={listboxId}
            aria-labelledby={label ? `${listboxId}-label` : undefined}
            className={POPOVER}
            tabIndex={-1}
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA 1.2 combobox pattern — <ul role="listbox"> has no single native equivalent.
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: <ul role="listbox"> is the WAI-ARIA authoring pattern for combobox popups.
            role="listbox"
          >
            {options.map((option, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard input is owned by the combobox trigger (Enter/arrows/Escape).
              <li
                key={option.value}
                // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: <li role="option"> is the WAI-ARIA listbox option pattern.
                // biome-ignore lint/a11y/useSemanticElements: no native option element exists outside a closed <select>.
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                tabIndex={-1}
                onClick={() => select(option)}
                onMouseEnter={() => !option.disabled && setActiveIndex(i)}
                className={`${OPTION} ${option.disabled ? 'cursor-not-allowed opacity-50' : ''} ${
                  option.value === activeValue && option.value !== value
                    ? 'bg-gray-100 dark:bg-white/5'
                    : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === value && (
                  <Check size={15} aria-hidden className="shrink-0 text-brand-500" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Multi-select ─────────────────────────────────────────────────────────────

export interface MultiSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: readonly ListboxOption[];
  label?: ReactNode;
  /** Trigger copy when nothing is selected (e.g. "All vehicles (tenant-wide)"). */
  placeholder?: ReactNode;
  /** Row rendered when `options` is empty. */
  emptyMessage?: ReactNode;
  /** Resolves a selected value to chip copy (defaults to the option label). */
  renderChip?: (value: string) => ReactNode;
  disabled?: boolean;
  className?: string;
  wrapperClassName?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function MultiSelect({
  values,
  onChange,
  options,
  label,
  placeholder,
  emptyMessage,
  renderChip,
  disabled = false,
  className = '',
  wrapperClassName = '',
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const rootRef = usePopover(open, () => setOpen(false));

  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  };

  return (
    <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
      {label && (
        <span
          id={`${listboxId}-label`}
          className="text-sm font-medium text-gray-700 dark:text-graydark-800"
        >
          {label}
        </span>
      )}
      <div ref={rootRef} className={`relative ${className}`}>
        <button
          type="button"
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA 1.2 combobox pattern — a native <select> cannot render the custom TailAdmin listbox.
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-labelledby={label ? `${listboxId}-label` : undefined}
          aria-label={ariaLabel}
          data-testid={dataTestId}
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-start text-sm text-gray-900 transition-colors focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-graydark-300 dark:text-white"
        >
          {values.length === 0 ? (
            <span className="truncate text-gray-400 dark:text-graydark-600">
              {placeholder ?? '—'}
            </span>
          ) : (
            values.map((v) => (
              <span
                key={v}
                className="inline-flex max-w-40 items-center truncate rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-graydark-700"
              >
                {renderChip ? renderChip(v) : (options.find((o) => o.value === v)?.label ?? v)}
              </span>
            ))
          )}
          <ChevronDown
            size={15}
            aria-hidden
            className="ms-auto shrink-0 self-center text-gray-400 rtl:rotate-180 dark:text-graydark-600"
          />
        </button>
        {open && (
          <ul
            id={listboxId}
            aria-multiselectable="true"
            aria-labelledby={label ? `${listboxId}-label` : undefined}
            className={POPOVER}
            tabIndex={-1}
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA 1.2 combobox pattern — <ul role="listbox"> has no single native equivalent.
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: <ul role="listbox"> is the WAI-ARIA authoring pattern for combobox popups.
            role="listbox"
          >
            {options.length === 0 && emptyMessage ? (
              <li className="cursor-default px-3 py-2 text-sm text-gray-400 dark:text-graydark-600">
                {emptyMessage}
              </li>
            ) : (
              options.map((option) => {
                const checked = values.includes(option.value);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: multi-select toggles via click; the trigger owns Escape/outside-close.
                  <li
                    key={option.value}
                    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: <li role="option"> is the WAI-ARIA listbox option pattern.
                    // biome-ignore lint/a11y/useSemanticElements: no native option element exists outside a closed <select>.
                    role="option"
                    aria-selected={checked}
                    aria-disabled={option.disabled || undefined}
                    tabIndex={-1}
                    onClick={() => !option.disabled && toggle(option.value)}
                    className={`${OPTION} ${option.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <span
                      aria-hidden
                      className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        checked
                          ? 'border-brand-500 bg-brand-500 text-white'
                          : 'border-gray-300 dark:border-white/20'
                      }`}
                    >
                      {checked && <Check size={12} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

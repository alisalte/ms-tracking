import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useId } from 'react';

/**
 * Switch — TailAdmin toggle primitive (Tailwind).
 *
 * Boolean setting rows: track + sliding knob, label + error/hint wiring like
 * Input. `forwardRef` for react-hook-form. The native checkbox keeps the
 * semantics (keyboard + screen readers) while the visuals render the switch;
 * the knob slides via logical `justify-start → justify-end`, so RTL flips
 * automatically.
 */
export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label?: ReactNode;
  error?: string | null;
  hint?: string | null;
  className?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, error, hint, className = '', id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`flex w-full flex-col gap-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        {label && (
          <label
            htmlFor={inputId}
            className="cursor-pointer text-sm font-medium text-gray-700 dark:text-graydark-800"
          >
            {label}
          </label>
        )}
        <label htmlFor={inputId} className="relative inline-flex cursor-pointer items-center">
          <input
            ref={ref}
            type="checkbox"
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="peer sr-only"
            {...rest}
          />
          {/* Track — knob slides via logical justify (RTL-safe) */}
          <span className="flex h-5 w-9 items-center justify-start rounded-full bg-gray-300 p-0.5 transition-colors peer-checked:justify-end peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/30 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 dark:bg-graydark-200">
            <span className="size-4 rounded-full bg-white shadow" />
          </span>
        </label>
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-danger-600 dark:text-danger-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-gray-500 dark:text-graydark-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

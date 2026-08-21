import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useId } from 'react';

/**
 * Checkbox — TailAdmin checkbox primitive (Tailwind).
 *
 * Label/error wiring mirrors Input (label ↔ input association, `aria-invalid`,
 * `aria-describedby`). `forwardRef` so react-hook-form `register` works
 * unchanged. The native checkbox is styled via `appearance-none` — checked
 * renders a brand check glyph.
 */
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label?: ReactNode;
  error?: string | null;
  hint?: string | null;
  className?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
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
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          type="checkbox"
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="size-4 shrink-0 cursor-pointer appearance-none rounded border border-gray-300 bg-white transition-colors checked:border-brand-500 checked:bg-brand-500 indeterminate:border-brand-500 indeterminate:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-graydark-300"
          {...rest}
        />
        {label && (
          <label
            htmlFor={inputId}
            className="cursor-pointer text-sm font-medium text-gray-700 dark:text-graydark-800"
          >
            {label}
          </label>
        )}
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

import { ChevronDown } from 'lucide-react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';

/**
 * Select — TailAdmin select primitive (Tailwind, native `<select>`).
 *
 * Deliberately built on the native select for keyboard/ARIA/screen-reader
 * correctness with zero dependencies; styled to the TailAdmin surface. Options
 * come from `options` or children. `forwardRef` for react-hook-form.
 */
export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  label?: ReactNode;
  error?: string | null;
  hint?: string | null;
  options?: SelectOption[];
  className?: string;
  wrapperClassName?: string;
  /**
   * Empty-value hint option rendered first (`value=""`, hidden from the open
   * dropdown list). Without it, a controlled `value=""` matches no option, so
   * the browser auto-selects option[0] when options arrive asynchronously —
   * the box then LOOKS chosen while the form state is still empty, and
   * re-picking that option fires no change event (the value never differs).
   */
  placeholder?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    error,
    hint,
    options,
    className = '',
    wrapperClassName = '',
    placeholder,
    id,
    children,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const errorId = error ? `${selectId}-error` : undefined;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`flex w-full flex-col gap-1.5 ${wrapperClassName}`}>
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-gray-700 dark:text-graydark-800"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`h-9 w-full appearance-none rounded-lg border bg-white px-3 pe-8 text-sm text-gray-900 transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-graydark-300 dark:text-white ${
            error
              ? 'border-danger-400 focus-visible:ring-danger-500'
              : 'border-gray-300 focus-visible:border-brand-500 focus-visible:ring-brand-500/30 dark:border-white/10'
          } ${className}`}
          {...rest}
        >
          {placeholder !== undefined && (
            <option value="" hidden>
              {placeholder}
            </option>
          )}
          {options
            ? options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          size={15}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 end-0 my-auto me-2.5 text-gray-400 rtl:rotate-180 dark:text-graydark-600"
        />
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

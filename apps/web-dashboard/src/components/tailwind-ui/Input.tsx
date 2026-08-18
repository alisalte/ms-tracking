import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useId } from 'react';

/**
 * Input — TailAdmin text field primitive (Tailwind).
 *
 * Label/error/hint wired for accessibility (label ↔ input association,
 * `aria-invalid`, `aria-describedby`). `forwardRef` so react-hook-form
 * `register`/`Controller` work unchanged. No preflight dependency: explicit
 * border/bg on the native input.
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label?: ReactNode;
  error?: string | null;
  hint?: string | null;
  leftIcon?: ReactNode;
  className?: string;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, leftIcon, className = '', wrapperClassName = '', id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`flex w-full flex-col gap-1.5 ${wrapperClassName}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-gray-700 dark:text-graydark-800"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-gray-400 dark:text-graydark-600 [&_svg]:size-4">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`h-9 w-full rounded-lg border bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-graydark-300 dark:text-white dark:placeholder:text-graydark-600 ${
            error
              ? 'border-danger-400 focus-visible:ring-danger-500'
              : 'border-gray-300 focus-visible:border-brand-500 focus-visible:ring-brand-500/30 dark:border-white/10'
          } ${leftIcon ? 'ps-9' : ''} ${className}`}
          {...rest}
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

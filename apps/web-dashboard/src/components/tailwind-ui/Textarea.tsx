import type { ReactNode, TextareaHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';

/**
 * Textarea — TailAdmin multi-line field primitive (Tailwind).
 *
 * Same label/error/hint accessibility wiring as Input, `forwardRef` for
 * react-hook-form. Explicit border/bg (no preflight dependency).
 */
export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label?: ReactNode;
  error?: string | null;
  hint?: string | null;
  className?: string;
  wrapperClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className = '', wrapperClassName = '', id, rows = 3, ...rest },
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
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full resize-y rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-graydark-300 dark:text-white dark:placeholder:text-graydark-600 ${
          error
            ? 'border-danger-400 focus-visible:ring-danger-500'
            : 'border-gray-300 focus-visible:border-brand-500 focus-visible:ring-brand-500/30 dark:border-white/10'
        } ${className}`}
        {...rest}
      />
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

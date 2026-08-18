/**
 * Spinner — TailAdmin loading indicator (Tailwind).
 *
 * Announces itself as a live region (`role="status"`) with a visually hidden
 * label so screen readers perceive loading states.
 */
export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label; defaults to "Loading…". */
  label?: string;
  className?: string;
}

const SIZES: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'size-4 border-2',
  md: 'size-6 border-2',
  lg: 'size-8 border-[3px]',
};

export function Spinner({ size = 'md', label = 'Loading…', className = '' }: SpinnerProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: no native <status> element exists; ARIA live region is the correct pattern
    <span role="status" className={`inline-flex items-center gap-2 ${className}`}>
      <span
        aria-hidden
        className={`inline-block animate-spin rounded-full border-solid border-current border-t-transparent text-brand-500 dark:text-brand-400 ${SIZES[size]}`}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

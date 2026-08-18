/**
 * Skeleton — TailAdmin placeholder shimmer (Tailwind).
 *
 * Purely decorative (`aria-hidden`); pair with a `role="status"` announcement
 * at the container level for accessible loading states.
 */
export interface SkeletonProps {
  className?: string;
  /** Render a circular skeleton (avatars, icon slots). */
  circle?: boolean;
}

export function Skeleton({ className = '', circle = false }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={`animate-pulse bg-gray-200 dark:bg-graydark-300 ${circle ? 'rounded-full' : 'rounded-md'} ${className}`}
    />
  );
}

import type { ReactNode } from 'react';

/**
 * EmptyState — TailAdmin zero-data placeholder (Tailwind).
 *
 * Announced politely (`role="status"`); icon/title/description/action slots so
 * pages can render "no rows yet" guidance consistently. Pass an `icon` such as
 * `<Inbox />` from lucide-react; when omitted a neutral circle is skipped and
 * only the copy renders.
 */
export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Optional call-to-action rendered under the copy (e.g. a primary button). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: no native <status> element exists; ARIA live region is the correct pattern
      role="status"
      className={`flex flex-col items-center justify-center gap-2 px-6 py-12 text-center ${className}`}
    >
      {icon && (
        <span
          aria-hidden
          className="mb-1 inline-flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-graydark-300 dark:text-graydark-700 [&_svg]:size-6"
        >
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-gray-700 dark:text-graydark-800">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-gray-500 dark:text-graydark-700">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

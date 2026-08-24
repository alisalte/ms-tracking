import type { ReactNode } from 'react';

/**
 * PageHeader — the TailAdmin page header pattern (Phase 2.5 §4).
 *
 * Standard page anatomy on a flat page background (NOT a colored banner):
 *
 *   Breadcrumb (Header)  →  PageHeader {title, description, actions}
 *                        →  Filters / Toolbar
 *                        →  Main content
 *
 * Title uses the TailAdmin display scale (text-title-md2 ≈ 1.5rem semibold),
 * description one grade below body, actions pinned to the inline end and
 * wrapping under on narrow screens. Dark-mode aware, RTL-safe via logical
 * layout only (flex + gap — no directional margins).
 */
export interface PageHeaderProps {
  /** Page title (h1). Already-translated ReactNode. */
  title: ReactNode;
  /** Small overline label above the title (section name, breadcrumb-style). */
  eyebrow?: ReactNode;
  /** Optional supporting line under the title. */
  description?: ReactNode;
  /** End-aligned actions (primary button, live badge, …). */
  actions?: ReactNode;
  /** Bottom hairline separator (for dense tool pages). */
  divider?: boolean;
  className?: string;
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  divider = false,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={`mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
        divider ? 'border-b border-gray-200 pb-4 dark:border-white/10' : ''
      } ${className}`}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-0.5 text-xs font-bold tracking-[0.08em] text-brand-600 uppercase dark:text-brand-300">
            {eyebrow}
          </p>
        )}
        <h1 className="truncate text-[1.5rem] leading-tight font-bold tracking-tight text-gray-900 dark:text-white">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-graydark-600">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

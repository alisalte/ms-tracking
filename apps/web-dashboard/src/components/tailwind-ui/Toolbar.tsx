import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Toolbar — the TailAdmin filter/action strip above tables and lists.
 *
 * Renders an optional built-in search field, then `left` controls (filters,
 * selects), a flexible spacer, and `right` controls (counts, actions).
 * RTL-safe via flexbox with logical gaps.
 */
export interface ToolbarProps {
  /** Left-aligned controls (filters, selects). */
  left?: ReactNode;
  /** Right-aligned controls (count, actions). */
  right?: ReactNode;
  /** Show a built-in search input on the left. */
  search?: boolean;
  /** Controlled search value (when using the built-in search). */
  searchValue?: string;
  /** Search change handler. */
  onSearchChange?: (value: string) => void;
  /** Search placeholder (already translated). */
  searchPlaceholder?: string;
  children?: ReactNode;
  className?: string;
}

export function Toolbar({
  left,
  right,
  search = false,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  children,
  className = '',
}: ToolbarProps) {
  const { t } = useTranslation();
  const placeholder = searchPlaceholder ?? t('common.search');

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-graydark-300 ${className}`}
    >
      {search && (
        <div className="flex h-9 min-w-52 max-w-72 flex-1 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 transition-colors focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30 dark:border-white/10 dark:bg-graydark-300">
          <Search size={14} aria-hidden className="shrink-0 text-gray-400 dark:text-graydark-600" />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="h-full w-full min-w-0 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-graydark-800 dark:placeholder:text-graydark-600 [&::-webkit-search-cancel-button]:hidden"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange?.('')}
              aria-label={t('common.clear', { defaultValue: 'Clear' })}
              className="flex shrink-0 cursor-pointer border-none bg-transparent p-0 text-gray-400 hover:text-gray-600 dark:hover:text-graydark-700"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {left}
      <div className="flex-1" />
      {right}
      {children}
    </div>
  );
}

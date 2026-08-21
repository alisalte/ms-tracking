import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from './Skeleton';

/** Cell alignment — logical so RTL flips automatically. */
export type Align = 'start' | 'end' | 'center';

export interface Column<Row> {
  /** Stable key (also used for React keys + sort state). */
  id: string;
  /** Header label (i18n key — translated). */
  headerKey?: string;
  /** Header label (raw node; takes precedence over headerKey). */
  header?: ReactNode;
  /** Cell renderer. */
  render: (row: Row, index: number) => ReactNode;
  /** Horizontal alignment (default start — logical, RTL-aware). */
  align?: Align;
  /** Preferred width for the column. */
  width?: number | string;
  /** Wrap cell content instead of ellipsising (default nowrap). */
  nowrap?: boolean;
  /**
   * Enable client-side sorting for this column: extract the comparison value
   * from a row. Omit for non-sortable columns (actions, avatars, …).
   */
  sortBy?: (row: Row) => string | number;
}

interface DataTableProps<Row> {
  rows: Row[];
  columns: Array<Column<Row>>;
  rowKey: (row: Row) => string | number;
  /** While loading, render skeleton rows. */
  loading?: boolean;
  /** Skeleton row count while loading (default 6). */
  loadingRows?: number;
  /** i18n key for the zero-rows message (default "common.noData"). */
  emptyKey?: string;
  /** Custom empty-state node (takes precedence over emptyKey). */
  emptyState?: ReactNode;
  /** Row click handler — makes rows hoverable + clickable. */
  onRowClick?: (row: Row) => void;
  /** Selected row key (highlights the row). */
  selectedKey?: string | null;
  /** Max container height — enables sticky-header scrolling. */
  maxHeight?: number | string;
  /** Dense row padding (default true — the ops-console look). */
  dense?: boolean;
  /** Zebra striping. */
  striped?: boolean;
  /** Hide the header row. */
  hideHeader?: boolean;
}

const ALIGN_CLASS: Record<Align, string> = {
  start: 'text-start',
  end: 'text-end',
  center: 'text-center',
};

interface SortState {
  id: string;
  dir: 'asc' | 'desc';
}

/**
 * DataTable — the one table pattern for the whole app (Tailwind).
 *
 * Column-def API deliberately mirrors the legacy MUI `ui/DataTable` so page
 * ports stay mechanical. Provides: uppercase tracked headers, optional
 * client-side column sorting (`sortBy`), hover + selection, zebra striping,
 * sticky header, a uniform skeleton loading state, and a uniform empty state.
 * Filtering and pagination stay in the owning page — this is presentational.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  loading = false,
  loadingRows = 6,
  emptyKey = 'common.noData',
  emptyState,
  onRowClick,
  selectedKey,
  maxHeight,
  dense = true,
  striped = false,
  hideHeader = false,
}: DataTableProps<Row>) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<SortState | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.id === sort.id);
    if (!column?.sortBy) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = column.sortBy?.(a) ?? '';
      const vb = column.sortBy?.(b) ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * factor;
    });
  }, [rows, columns, sort]);

  const toggleSort = (id: string) => {
    setSort((current) => {
      if (current?.id !== id) return { id, dir: 'asc' };
      if (current.dir === 'asc') return { id, dir: 'desc' };
      return null;
    });
  };

  const cellPad = dense ? 'px-4 py-2.5' : 'px-4 py-3.5';

  return (
    <div
      className="fv-scroll w-full overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-graydark-300"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-sm">
        {!hideHeader && (
          <thead className="sticky top-0 z-10 bg-gray-50 text-gray-500 dark:bg-graydark-200 dark:text-graydark-600">
            <tr>
              {columns.map((col) => {
                const sortable = Boolean(col.sortBy);
                const active = sort?.id === col.id;
                const SortIcon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    style={{ width: col.width, minWidth: col.width }}
                    className={`whitespace-nowrap px-4 py-3 text-xs font-semibold tracking-wide uppercase ${ALIGN_CLASS[col.align ?? 'start']}`}
                    aria-sort={
                      active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id)}
                        className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 font-inherit text-inherit transition-colors hover:text-gray-800 dark:hover:text-graydark-800"
                      >
                        {col.header ?? (col.headerKey ? t(col.headerKey) : null)}
                        <SortIcon
                          size={13}
                          aria-hidden
                          className={active ? 'text-brand-500' : 'opacity-40'}
                        />
                      </button>
                    ) : (
                      (col.header ?? (col.headerKey ? t(col.headerKey) : null))
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-gray-100 dark:divide-white/5">
          {loading
            ? Array.from({ length: loadingRows }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder
                <tr key={`skeleton-${i}`}>
                  {columns.map((col) => (
                    <td key={col.id} className={`${cellPad} ${ALIGN_CLASS[col.align ?? 'start']}`}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </td>
                  ))}
                </tr>
              ))
            : sorted.map((row, idx) => {
                const key = rowKey(row);
                const selected = selectedKey != null && String(selectedKey) === String(key);
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    aria-selected={selected || undefined}
                    className={`${onRowClick ? 'cursor-pointer' : ''} transition-colors ${
                      selected
                        ? 'bg-brand-50 dark:bg-brand-500/10'
                        : striped && idx % 2 === 1
                          ? 'bg-gray-50/60 dark:bg-white/[0.02]'
                          : ''
                    } ${
                      onRowClick
                        ? 'hover:bg-gray-50 dark:hover:bg-white/5'
                        : 'hover:bg-gray-50/60 dark:hover:bg-white/[0.03]'
                    }`}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={`${cellPad} text-gray-700 dark:text-graydark-800 ${ALIGN_CLASS[col.align ?? 'start']} ${
                          col.nowrap === false ? '' : 'whitespace-nowrap'
                        }`}
                      >
                        {col.render(row, idx)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center">
                {emptyState ?? (
                  <span className="text-sm text-gray-500 dark:text-graydark-600">
                    {t(emptyKey)}
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

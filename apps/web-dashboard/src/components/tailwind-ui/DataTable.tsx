import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CHECKBOX_INPUT_CLASS } from './Checkbox';
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
  /** Hide this column entirely (honored by column-visibility toggles). */
  hidden?: boolean;
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
  /** Failed-fetch node — takes precedence over rows/empty (compose ErrorState). */
  errorState?: ReactNode;
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
  /**
   * Row selection: adds a leading checkbox column. The table becomes a
   * `aria-multiselectable` grid; the header checkbox toggles every visible
   * (sorted) row.
   */
  selectable?: boolean;
  /** Currently selected row keys (controlled). */
  selectedKeys?: ReadonlyArray<string | number>;
  /** Selection change callback (controlled). */
  onSelectionChange?: (keys: Array<string | number>, rows: Row[]) => void;
  /** Bulk-action strip rendered above the table while rows are selected. */
  bulkActions?: (selectedRows: Row[]) => ReactNode;
  /** Accessible label for the selection column (i18n key). */
  selectAllKey?: string;
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
 * sticky header, a uniform skeleton loading state, a uniform empty state, a
 * failed-fetch `errorState` slot, optional row selection with a bulk-action
 * bar, per-column `hidden` toggling, and keyboard-activatable rows with
 * visible focus. Filtering and pagination stay in the owning page — this is
 * presentational.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  loading = false,
  loadingRows = 6,
  emptyKey = 'common.noData',
  emptyState,
  errorState,
  onRowClick,
  selectedKey,
  maxHeight,
  dense = true,
  striped = false,
  hideHeader = false,
  selectable = false,
  selectedKeys = [],
  onSelectionChange,
  bulkActions,
  selectAllKey = 'common.selectAll',
}: DataTableProps<Row>) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<SortState | null>(null);

  const visibleColumns = useMemo(() => columns.filter((c) => !c.hidden), [columns]);

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

  const selectedSet = useMemo(() => new Set(selectedKeys.map(String)), [selectedKeys]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedSet.has(String(rowKey(row)))),
    [rows, selectedSet, rowKey],
  );

  const allVisibleSelected =
    selectable && sorted.length > 0 && sorted.every((row) => selectedSet.has(String(rowKey(row))));
  const someSelected = selectable && selectedRows.length > 0;

  const toggleRow = (row: Row) => {
    if (!onSelectionChange) return;
    const key = String(rowKey(row));
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(
      [...next],
      rows.filter((r) => next.has(String(rowKey(r)))),
    );
  };

  const toggleAll = () => {
    if (!onSelectionChange) return;
    if (allVisibleSelected) {
      onSelectionChange(
        selectedKeys.filter((k) => !sorted.some((row) => String(rowKey(row)) === String(k))),
        [],
      );
    } else {
      const next = new Set(selectedSet);
      for (const row of sorted) next.add(String(rowKey(row)));
      onSelectionChange(
        [...next],
        rows.filter((r) => next.has(String(rowKey(r)))),
      );
    }
  };

  const cellPad = dense ? 'px-4 py-2.5' : 'px-4 py-3.5';
  const colCount = visibleColumns.length + (selectable ? 1 : 0);

  return (
    <div className="w-full">
      {selectable && someSelected && bulkActions && (
        <div
          data-testid="datatable-bulk-bar"
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-500/20 dark:bg-brand-500/10"
        >
          <span className="text-xs font-semibold text-brand-700 dark:text-brand-300">
            {t('common.selectedCount', { count: selectedRows.length })}
          </span>
          <div className="flex flex-wrap items-center gap-2">{bulkActions(selectedRows)}</div>
        </div>
      )}
      <div
        className="fv-scroll w-full overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-graydark-300"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full border-collapse text-sm">
          {!hideHeader && (
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-500 dark:bg-graydark-200 dark:text-graydark-600">
              <tr>
                {selectable && (
                  <th scope="col" className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={t(selectAllKey)}
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected && !allVisibleSelected;
                      }}
                      onChange={toggleAll}
                      className={CHECKBOX_INPUT_CLASS}
                    />
                  </th>
                )}
                {visibleColumns.map((col) => {
                  const sortable = Boolean(col.sortBy);
                  const active = sort?.id === col.id;
                  const SortIcon = !active
                    ? ChevronsUpDown
                    : sort.dir === 'asc'
                      ? ArrowUp
                      : ArrowDown;
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
            {errorState ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  {errorState}
                </td>
              </tr>
            ) : loading ? (
              Array.from({ length: loadingRows }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder
                <tr key={`skeleton-${i}`}>
                  {selectable && (
                    <td className="px-3 py-2.5">
                      <Skeleton className="size-4 rounded" />
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td key={col.id} className={`${cellPad} ${ALIGN_CLASS[col.align ?? 'start']}`}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center">
                  {emptyState ?? (
                    <span className="text-sm text-gray-500 dark:text-graydark-600">
                      {t(emptyKey)}
                    </span>
                  )}
                </td>
              </tr>
            ) : (
              sorted.map((row, idx) => {
                const key = rowKey(row);
                const selected = selectedKey != null && String(selectedKey) === String(key);
                const checked = selectable && selectedSet.has(String(key));
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault(); // Space must activate, not scroll
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-selected={selected || checked || undefined}
                    className={`${onRowClick ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50' : ''} transition-colors ${
                      selected || checked
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
                    {selectable && (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: click only stops row activation; keyboard input is owned by the checkbox input.
                      <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={String(key)}
                          checked={checked}
                          onChange={() => toggleRow(row)}
                          className={CHECKBOX_INPUT_CLASS}
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => (
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
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

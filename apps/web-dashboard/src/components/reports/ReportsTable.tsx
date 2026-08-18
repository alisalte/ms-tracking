import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TBody, TD, TH, THead, Table } from '@/components/tailwind-ui';

/**
 * ReportsTable — the TailAdmin report table (Phase 8).
 *
 * Same column-def contract as the legacy MUI DataTable (id / headerKey /
 * header / render), rendered with the tailwind Table kit, plus client-side
 * sorting: clicking a header toggles asc/desc on the rendered display value
 * (server stays the source of truth for the rows themselves). Rows are
 * keyboard-activatable when onRowClick is set.
 */
export interface Column<Row> {
  id: string;
  /** i18n key for the header (or `header` for a plain string). */
  headerKey?: string;
  header?: string;
  render: (row: Row) => React.ReactNode;
}

export interface ReportsTableProps<Row> {
  columns: Array<Column<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  emptyKey?: string;
  dense?: boolean;
}

export function ReportsTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyKey = 'reports.empty',
  dense = false,
}: ReportsTableProps<Row>) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.col);
    if (!col) return rows;
    const cellText = (row: Row): string => {
      const node = col.render(row);
      return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
    };
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = cellText(a);
      const vb = cellText(b);
      const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort, columns]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white py-10 text-center dark:border-white/5 dark:bg-graydark-300">
        <p className="text-sm text-gray-500 dark:text-graydark-600">{t(emptyKey)}</p>
      </div>
    );
  }

  return (
    <Table>
      <THead>
        <tr>
          {columns.map((col) => {
            const label = col.headerKey ? t(col.headerKey) : (col.header ?? '');
            const active = sort?.col === col.id;
            return (
              <TH key={col.id}>
                <button
                  type="button"
                  onClick={() =>
                    setSort((prev) =>
                      prev?.col === col.id
                        ? { col: col.id, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                        : { col: col.id, dir: 'asc' },
                    )
                  }
                  aria-label={`${label} — ${active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'sort'}`}
                  className={`inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-start text-xs font-semibold tracking-wide uppercase transition-colors hover:text-gray-700 dark:hover:text-graydark-800 ${
                    active ? 'text-gray-700 dark:text-graydark-800' : ''
                  }`}
                >
                  {label}
                  {active ? (
                    sort?.dir === 'asc' ? (
                      <ArrowUp size={12} aria-hidden />
                    ) : (
                      <ArrowDown size={12} aria-hidden />
                    )
                  ) : (
                    <ArrowUpDown size={12} aria-hidden className="opacity-30" />
                  )}
                </button>
              </TH>
            );
          })}
        </tr>
      </THead>
      <TBody>
        {sorted.map((row) => (
          <tr
            key={rowKey(row)}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            onKeyDown={
              onRowClick
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') onRowClick(row);
                  }
                : undefined
            }
            className={`transition-colors ${
              onRowClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5' : ''
            }`}
          >
            {columns.map((col) => (
              <TD key={col.id} className={dense ? 'py-2' : ''}>
                {col.render(row)}
              </TD>
            ))}
          </tr>
        ))}
      </TBody>
    </Table>
  );
}

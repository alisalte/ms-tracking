import {
  Box,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Cell alignment — logical so RTL flips automatically. */
export type Align = 'left' | 'right' | 'center';

export interface Column<Row> {
  /** Stable key (also used for the React key). */
  id: string;
  /** Header label (i18n key — translated). */
  headerKey?: string;
  /** Header label (raw; takes precedence over headerKey). */
  header?: ReactNode;
  /** Cell renderer. */
  render: (row: Row, index: number) => ReactNode;
  /** Horizontal alignment (default left). */
  align?: Align;
  /** Optional width / min-width. */
  width?: number | string;
  /** Don't show the wrapping ellipsis (default false). */
  nowrap?: boolean;
  /** Sticky header column. */
  sticky?: boolean;
}

interface DataTableProps<Row> {
  /** Rows to render. */
  rows: Row[];
  /** Column definitions. */
  columns: Array<Column<Row>>;
  /** Get a stable key for each row. */
  rowKey: (row: Row) => string | number;
  /** While loading, render skeleton rows. */
  loading?: boolean;
  /** Number of skeleton rows to show while loading (default 6). */
  loadingRows?: number;
  /** Message key rendered when there are zero rows (default "common.noData"). */
  emptyKey?: string;
  /** Custom empty state node (takes precedence over emptyKey). */
  emptyState?: ReactNode;
  /** Click handler — makes rows hoverable + clickable. */
  onRowClick?: (row: Row) => void;
  /** Selected row key (highlights the row). */
  selectedKey?: string | null;
  /** Max container height (enables sticky header scrolling). */
  maxHeight?: number | string;
  /** Dense row padding (default true — Limitless is dense). */
  dense?: boolean;
  /** Show zebra striping. */
  striped?: boolean;
  /** Hide the header row. */
  hideHeader?: boolean;
  /** Key used to map alignment to logical CSS property. */
  stickyHeader?: boolean;
}

const ALIGN: Record<Align, 'left' | 'right' | 'center'> = {
  left: 'left',
  right: 'right',
  center: 'center',
};

/**
 * DataTable — one consistent Limitless table pattern for the whole app.
 *
 * Replaces the ad-hoc `<Table>` markup duplicated across Trips/Assets/Admin/
 * Reports. Provides: uppercase tracked header, hover + selection, optional zebra
 * striping, sticky header, a uniform loading skeleton, and a uniform empty
 * state. All behavior (filtering, sorting, pagination) stays in the owning
 * page — this is purely presentational.
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
  stickyHeader = true,
}: DataTableProps<Row>) {
  const { t } = useTranslation();
  const colCount = columns.length;

  return (
    <TableContainer sx={{ maxHeight }}>
      <Table size={dense ? 'small' : 'medium'} stickyHeader={stickyHeader && Boolean(maxHeight)}>
        {!hideHeader && (
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  align={col.align ? ALIGN[col.align] : 'left'}
                  sx={{ width: col.width, minWidth: col.width, whiteSpace: 'nowrap' }}
                >
                  {col.header ?? (col.headerKey ? t(col.headerKey) : null)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
        )}
        <TableBody>
          {loading
            ? Array.from({ length: loadingRows }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  {columns.map((col) => (
                    <TableCell key={col.id} align={col.align ? ALIGN[col.align] : 'left'}>
                      <Skeleton height={18} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row, idx) => {
                const key = rowKey(row);
                const selected = selectedKey != null && String(selectedKey) === String(key);
                return (
                  <TableRow
                    key={key}
                    hover={Boolean(onRowClick)}
                    selected={selected}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    sx={{
                      cursor: onRowClick ? 'pointer' : 'default',
                      ...(striped && !selected && idx % 2 === 1
                        ? { backgroundColor: 'rgba(0,0,0,0.018)' }
                        : {}),
                    }}
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.id}
                        align={col.align ? ALIGN[col.align] : 'left'}
                        sx={{ whiteSpace: col.nowrap === false ? 'normal' : 'nowrap' }}
                      >
                        {col.render(row, idx)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
          {!loading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={colCount} align="center">
                {emptyState ?? (
                  <Stack alignItems="center" gap={1} sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      {t(emptyKey)}
                    </Typography>
                  </Stack>
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** A labeled count chip — "Showing 24" / "(24)" — used beside tables/toolbars. */
export function RowCount({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary">
        {t('common.rowCount', { count })}
      </Typography>
    </Box>
  );
}

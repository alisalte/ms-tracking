import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';

/**
 * LoadMoreButton — cursor-pagination footer ("Load more" pattern).
 *
 * Pairs with `useCursorPagination`: renders a centered button while
 * `hasNextPage`, with the pending state while the next page fetches.
 */
export function LoadMoreButton({
  hasNextPage,
  isFetchingNextPage,
  onClick,
  testId,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onClick: () => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  if (!hasNextPage) return null;
  return (
    <div className="flex justify-center">
      <Button
        variant="outline"
        onClick={onClick}
        loading={isFetchingNextPage}
        data-testid={testId}
      >
        {isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
      </Button>
    </div>
  );
}

/**
 * NumberedPagination — classic page navigation for client-paged lists.
 *
 * RTL-aware: the chevrons point the logical "previous/next" way via
 * `rtl:rotate-180`. Windowed page numbers with ellipses for large counts.
 */
export function NumberedPagination({
  page,
  pageCount,
  onChange,
  totalRows,
}: {
  /** Current page (1-based). */
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  /** Optional rendered total ("24 rows"). */
  totalRows?: number;
}) {
  const { t } = useTranslation();
  if (pageCount <= 1) return null;

  // Windowed numbers: always include 1, pageCount, and pages around `page`.
  const numbers: Array<number | 'ellipsis'> = [];
  const push = (n: number | 'ellipsis') => numbers.push(n);
  const rangeStart = Math.max(2, page - 1);
  const rangeEnd = Math.min(pageCount - 1, page + 1);
  push(1);
  if (rangeStart > 2) push('ellipsis');
  for (let n = rangeStart; n <= rangeEnd; n++) push(n);
  if (rangeEnd < pageCount - 1) push('ellipsis');
  if (pageCount > 1) push(pageCount);

  const navClass =
    'flex size-8 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <nav
      aria-label={t('common.pagination', { defaultValue: 'Pagination' })}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      {totalRows !== undefined && (
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {t('common.rowCount', { count: totalRows })}
        </span>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label={t('common.previous', { defaultValue: 'Previous' })}
          className={`${navClass} border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-700 dark:hover:bg-white/5 rtl:rotate-180`}
        >
          <ChevronLeft size={15} aria-hidden />
        </button>
        {numbers.map((n, i) =>
          n === 'ellipsis' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: static separators between stable page numbers
            <span key={`ellipsis-${i}`} className="px-1 text-gray-400 dark:text-graydark-600">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-current={n === page ? 'page' : undefined}
              className={`${navClass} ${
                n === page
                  ? 'border-brand-500 bg-brand-500 font-semibold text-white'
                  : 'cursor-pointer border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-700 dark:hover:bg-white/5'
              }`}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount}
          aria-label={t('common.next', { defaultValue: 'Next' })}
          className={`${navClass} border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-700 dark:hover:bg-white/5 rtl:rotate-180`}
        >
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>
    </nav>
  );
}

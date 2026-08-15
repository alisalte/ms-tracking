/**
 * useCursorPagination — a thin wrapper over TanStack Query's `useInfiniteQuery`
 * for cursor-based pagination against FleetVision backends that return `Page<T>`.
 *
 * Prevents unbounded client-side loading: each page fetches a bounded batch
 * (the backend caps at MAX_PAGE_SIZE=100), and the caller renders a "Load more"
 * control only when `hasNextPage` is true.
 *
 * Usage in an API module:
 *   const useUsersPage = () => {
 *     return useCursorPagination('users', (cursor) =>
 *       apiGet<Page<UserWire>>('/iam/users', { cursor, limit: 25 }).then(mapPage),
 *     );
 *   };
 * In a page:
 *   const { items, hasNextPage, fetchNextPage, isFetchingNextPage } = useUsersPage();
 */
import { useInfiniteQuery } from '@tanstack/react-query';

import type { Page } from '@/types/api.types';

export interface CursorPaginationResult<T> {
  /** All items accumulated across fetched pages. */
  items: T[];
  /** Whether a next page exists (nextCursor !== null on the last page). */
  hasNextPage: boolean;
  /** Fetch the next page (no-op if hasNextPage is false). */
  fetchNextPage: () => void;
  /** Currently fetching the next page. */
  isFetchingNextPage: boolean;
  /** Initial load (first page) is in progress. */
  isLoading: boolean;
  /** Any page load failed. */
  isError: boolean;
  /** The error object. */
  error: unknown;
  /** Refetch the first page. */
  refetch: () => void;
}

/**
 * @param queryKey  Stable TanStack Query key (array).
 * @param fetchPage Fetcher returning a `Page<T>` for the given cursor (undefined = first page).
 */
export function useCursorPagination<T>(
  queryKey: readonly unknown[],
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): CursorPaginationResult<T> {
  const query = useInfiniteQuery<Page<T>>({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.data) ?? [];
  const lastPage = query.data?.pages[query.data.pages.length - 1];
  const hasNextPage = Boolean(lastPage?.nextCursor);

  return {
    items,
    hasNextPage,
    fetchNextPage: () => {
      if (hasNextPage) void query.fetchNextPage();
    },
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

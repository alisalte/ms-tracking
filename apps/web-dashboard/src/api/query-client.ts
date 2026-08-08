import { QueryClient } from '@tanstack/react-query';

/**
 * Default TanStack Query client.
 *
 * Configured with sensible defaults for a real-time dashboard:
 * - 30s stale time (live data refreshed periodically)
 * - 1 retry on failure
 * - Refetch on window focus
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

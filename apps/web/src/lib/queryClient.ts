import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './apiClient';

/**
 * Server state is owned by TanStack Query, not by component state.
 *
 * WHY: prices and stock are shared, changing data that lives on the server. Copy
 * it into component state and it goes stale the moment somebody else edits it.
 * Query keeps one cache, refetches when a window regains focus, and gives every
 * screen loading and error states for free.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Staff move between screens constantly; a short freshness window avoids
      // a refetch storm without ever showing a badly outdated price.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry(failureCount, error) {
        // Retrying a 401, 403 or 422 just repeats a decision the server has
        // already made. Only transient failures are worth another attempt.
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

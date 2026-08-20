import type { ApiError, ApiPaginated, ApiSuccess, PaginationMeta } from '@shopos/shared';
import { getAccessToken, useAuthStore, type Session } from '@/stores/authStore';

/**
 * The single way the web app talks to the ShopOS API.
 *
 * Three jobs beyond plain fetch:
 *
 *  1. Attach the access token, which lives in memory rather than localStorage.
 *  2. Understand the response envelope and turn a failure into a typed error.
 *  3. Refresh a expired token once, transparently, and retry the request.
 *
 * That third point is why a wrapper is worth having at all. Access tokens last
 * fifteen minutes; without this, a shop assistant would be thrown back to the
 * login screen four times an hour.
 *
 * A plain fetch wrapper covers all of it - axios would be a dependency for
 * features this file already implements in under a hundred lines.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const API_ROOT = `${BASE_URL}/api/v1`;

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Internal: prevents a refresh loop if the refresh call itself 401s. */
  skipRefresh?: boolean;
}

/**
 * Only one refresh runs at a time.
 *
 * Without this, a dashboard firing six queries at once would send six refresh
 * requests. Because refresh tokens rotate and reuse is treated as theft, five of
 * those would present an already-rotated token and get the whole session
 * revoked - logging the user out for doing nothing wrong.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_ROOT}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return false;

      const payload = (await response.json()) as ApiSuccess<Session>;
      useAuthStore.getState().setSession(payload.data);
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all observe this result.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const { body, headers, skipRefresh: _skip, ...rest } = options;
  const token = getAccessToken();

  return fetch(`${API_ROOT}${path}`, {
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function request<TResponse>(path: string, options: RequestOptions = {}): Promise<TResponse> {
  let response: Response;
  try {
    response = await rawRequest(path, options);
  } catch {
    throw new ApiRequestError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your internet connection.',
    );
  }

  // One transparent retry after a refresh. If the refresh fails the session is
  // genuinely over and the app falls back to the login screen.
  if (response.status === 401 && !options.skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await rawRequest(path, { ...options, skipRefresh: true });
    } else {
      useAuthStore.getState().clearSession();
    }
  }

  if (response.status === 204) return undefined as TResponse;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload as ApiError | null;
    throw new ApiRequestError(
      response.status,
      error?.error?.code ?? 'INTERNAL_ERROR',
      error?.error?.message ?? 'Something went wrong',
      error?.error?.details,
    );
  }

  return payload as TResponse;
}

async function unwrap<TData>(path: string, options?: RequestOptions): Promise<TData> {
  const response = await request<ApiSuccess<TData>>(path, options);
  return response.data;
}

/** Build a query string, leaving out anything blank. */
export function toQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export interface PaginatedResult<TItem> {
  items: TItem[];
  pagination: PaginationMeta;
}

export const api = {
  get: <TData>(path: string) => unwrap<TData>(path, { method: 'GET' }),
  post: <TData>(path: string, body?: unknown) => unwrap<TData>(path, { method: 'POST', body }),
  patch: <TData>(path: string, body?: unknown) => unwrap<TData>(path, { method: 'PATCH', body }),
  put: <TData>(path: string, body?: unknown) => unwrap<TData>(path, { method: 'PUT', body }),
  delete: <TData>(path: string) => unwrap<TData>(path, { method: 'DELETE' }),

  /** Paginated endpoints, keeping the pagination block alongside the rows. */
  async list<TItem>(path: string): Promise<PaginatedResult<TItem>> {
    const response = await request<ApiPaginated<TItem>>(path, { method: 'GET' });
    return { items: response.data, pagination: response.pagination };
  },
};

/**
 * Restore a session on page load from the httpOnly refresh cookie.
 *
 * Called once when the app mounts. A failure here is normal - it simply means
 * nobody is signed in.
 */
export async function bootstrapSession(): Promise<void> {
  const restored = await refreshSession();
  if (!restored) useAuthStore.getState().setBootstrapped();
}

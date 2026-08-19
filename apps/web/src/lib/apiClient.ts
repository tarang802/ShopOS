import type { ApiError, ApiPaginated, ApiSuccess } from '@shopos/shared';

/**
 * The single way the web app talks to the ShopOS API.
 *
 * WHAT: a thin fetch wrapper that understands the API's response envelope and
 * turns a failure into a typed exception.
 *
 * WHY one wrapper instead of fetch everywhere: authentication headers, error
 * translation and the base URL all need to change in exactly one place. When
 * refresh-token handling arrives in Phase 3, it is added here and every screen
 * in the app inherits it without being touched.
 *
 * A plain fetch wrapper is enough - axios would add a dependency for features
 * (interceptors, transforms) that this file already covers in 60 lines.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/** An error the API reported deliberately, carrying its machine-readable code. */
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
}

async function request<TResponse>(path: string, options: RequestOptions = {}): Promise<TResponse> {
  const { body, headers, ...rest } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/v1${path}`, {
      ...rest,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      // Refresh tokens will travel in an httpOnly cookie, so credentials are
      // always included.
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
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

/** Unwraps { success, data } so callers work with the payload directly. */
async function unwrap<TData>(path: string, options?: RequestOptions): Promise<TData> {
  const response = await request<ApiSuccess<TData>>(path, options);
  return response.data;
}

export const api = {
  get: <TData>(path: string) => unwrap<TData>(path, { method: 'GET' }),
  post: <TData>(path: string, body?: unknown) => unwrap<TData>(path, { method: 'POST', body }),
  patch: <TData>(path: string, body?: unknown) => unwrap<TData>(path, { method: 'PATCH', body }),
  put: <TData>(path: string, body?: unknown) => unwrap<TData>(path, { method: 'PUT', body }),
  delete: <TData>(path: string) => unwrap<TData>(path, { method: 'DELETE' }),

  /** Paginated endpoints keep their pagination block, so callers get both. */
  list: <TItem>(path: string) => request<ApiPaginated<TItem>>(path, { method: 'GET' }),
};

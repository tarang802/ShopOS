/**
 * The ShopOS API response contract.
 *
 * WHAT: every endpoint returns one of these three shapes - never a bare object,
 * never a bare array.
 *
 * WHY: the web client (and later the mobile app) can then have exactly one place
 * that understands success, failure and paging. Without a fixed envelope, every
 * screen invents its own error handling and they all drift apart.
 */

export interface ApiSuccess<TData> {
  success: true;
  data: TData;
  message?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiPaginated<TItem> {
  success: true;
  data: TItem[];
  pagination: PaginationMeta;
  message?: string;
}

/** One field-level problem, produced from a validation failure. */
export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
}

export type ApiResponse<TData> = ApiSuccess<TData> | ApiError;

/**
 * Machine-readable error codes.
 *
 * The client switches on `code`, never on `message`. Messages are for humans and
 * may be reworded or translated at any time; codes are a contract.
 */
export const ERROR_CODES = {
  // 400 family
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',

  // 401 / 403
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',

  // 404 / 409
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',

  // 422 - the request was well-formed but breaks a business rule
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  PRICE_NOT_FOUND: 'PRICE_NOT_FOUND',
  OVERLAPPING_PRICE_TIERS: 'OVERLAPPING_PRICE_TIERS',

  // 429 / 500
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

import { z } from 'zod';

/**
 * Shared paging, sorting and search parameters.
 *
 * Every list endpoint accepts these. Defining them once means page size limits
 * are enforced identically everywhere - a client cannot ask for 1,000,000 rows
 * on one endpoint just because that endpoint forgot to cap it.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sortBy: z.string().trim().min(1).max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(200).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Turn a validated page/limit pair into the skip value Mongo needs. */
export function toSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function buildPaginationMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

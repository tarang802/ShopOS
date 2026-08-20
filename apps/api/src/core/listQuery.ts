import type { Model, SortOrder } from 'mongoose';
import { toSkip, type PaginationQuery } from '@shopos/shared';

/**
 * One paginated list implementation, used by every list endpoint.
 *
 * WHY centralise it: page size caps, sort whitelisting and the count query are
 * easy to get subtly wrong, and getting them wrong on one endpoint out of twenty
 * is how a list route ends up returning the whole collection. Written once, it
 * behaves identically everywhere.
 *
 * `sortBy` is checked against an allow-list rather than passed through. An
 * arbitrary sort field lets a caller sort by an unindexed column and turn a fast
 * query into a collection scan, and on some drivers it is an injection surface.
 */

export interface ListResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Mongoose 9 keeps its filter type internal rather than exporting FilterQuery,
 * so dynamic filters are built as plain objects. They are still checked at the
 * point of use by the driver.
 */
export type Filter = Record<string, unknown>;

export interface ListOptions<T> {
  model: Model<T>;
  filter: Filter;
  query: PaginationQuery;
  /** Fields a client is permitted to sort by. */
  sortableFields: readonly string[];
  defaultSort: Record<string, SortOrder>;
  /** Fields to leave out of the response, e.g. heavy embedded arrays. */
  projection?: Record<string, 0 | 1>;
  populate?: { path: string; select?: string }[];
}

export async function paginate<T>(options: ListOptions<T>): Promise<ListResult<T>> {
  const { model, filter, query, sortableFields, defaultSort, projection, populate } = options;

  const sort: Record<string, SortOrder> =
    query.sortBy && sortableFields.includes(query.sortBy)
      ? { [query.sortBy]: query.sortOrder === 'asc' ? 1 : -1 }
      : defaultSort;

  let find = model
    .find(filter, projection)
    .sort(sort)
    .skip(toSkip(query.page, query.limit))
    .limit(query.limit);

  for (const relation of populate ?? []) {
    find = find.populate(relation.path, relation.select);
  }

  // The count runs alongside the page rather than after it. Both hit the same
  // index, so the round trip is paid once instead of twice.
  const [items, total] = await Promise.all([
    find.lean<T[]>().exec(),
    model.countDocuments(filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

/**
 * Turn a user-typed search string into a safe case-insensitive prefix pattern.
 *
 * Regular expression metacharacters are escaped, so a customer named "C++" or a
 * search for "(new)" cannot alter the pattern or produce a catastrophic
 * backtracking case.
 */
export function safeSearchRegex(term: string): RegExp {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

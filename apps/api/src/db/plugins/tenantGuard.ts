import type { Query, Schema } from 'mongoose';

/**
 * Tenant isolation, enforced by construction.
 *
 * WHAT: any query against an organization-owned collection that does not filter
 * by `organizationId` throws before it reaches MongoDB.
 *
 * WHY: isolation that depends on every developer remembering to add
 * `organizationId` to every query will eventually leak - it only takes one
 * forgotten filter on one endpoint, and a shop in Bhagalpur sees the rates of a
 * shop in Patna. Making the omission an immediate, loud crash turns a silent
 * data breach into an obvious bug on the first test run.
 *
 * HOW: a pre-hook on every read and write. The rare legitimate cross-tenant
 * query - looking a user up by email at login, or seeding - opts out explicitly
 * with `.setOptions({ allowCrossTenant: true })`, so the exception is visible in
 * the code rather than implied by its absence.
 *
 * Note: aggregation pipelines are not covered by this hook. Aggregations must
 * put a `$match` on `organizationId` as their first stage, and that is checked
 * by review rather than by the driver.
 */

/** Every query operation that reads or writes documents. */
const GUARDED_OPERATIONS = [
  'count',
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
] as const;

export class TenantScopeError extends Error {
  constructor(modelName: string, operation: string) {
    super(
      `Refused a ${operation} on ${modelName} without an organizationId filter. ` +
        'Scope the query to the current tenant, or opt out explicitly with ' +
        'setOptions({ allowCrossTenant: true }).',
    );
    this.name = 'TenantScopeError';
  }
}

interface GuardOptions {
  allowCrossTenant?: boolean;
}

type GuardedQuery = Query<unknown, unknown> & { op?: string };

/**
 * Mongoose 9 query middleware is promise-based: a hook signals failure by
 * throwing rather than by calling a `next` callback.
 */
type QueryHook = (this: GuardedQuery) => void;

export function tenantGuard(schema: Schema): void {
  const guard: QueryHook = function guard(this: GuardedQuery) {
    const options = this.getOptions() as GuardOptions;
    if (options.allowCrossTenant) return;

    const filter = this.getFilter();
    if (filter && filter.organizationId !== undefined && filter.organizationId !== null) return;

    throw new TenantScopeError(this.model.modelName, this.op ?? 'query');
  };

  // Mongoose types the multi-operation form of `pre` too narrowly to express a
  // single hook shared across every query operation, so the registration is cast
  // once here rather than the hook itself being loosely typed. `bind` keeps the
  // schema as the receiver, which the cast would otherwise discard.
  const registerHook = schema.pre.bind(schema) as unknown as (op: string, fn: QueryHook) => void;
  for (const operation of GUARDED_OPERATIONS) {
    registerHook(operation, guard);
  }
}

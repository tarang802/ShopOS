import { Types } from 'mongoose';
import type { Permission } from '@shopos/shared';
import { AppError } from './AppError';

/**
 * Who is asking, on behalf of which business, and what they may do.
 *
 * Every service method takes one of these. It is built by the authentication
 * middleware from the session - never from the request body - which is what
 * makes "a client cannot name the organization it wants" true by construction
 * rather than by discipline.
 */
export interface TenantContext {
  userId: Types.ObjectId;
  userName: string;
  organizationId: Types.ObjectId;
  membershipId: Types.ObjectId;
  roleId: Types.ObjectId;
  roleName: string;
  permissions: ReadonlySet<Permission>;
  /** True when this person works across every branch, including future ones. */
  allBranches: boolean;
  /** Branches this person may act in. Empty when `allBranches` is true. */
  branchIds: Types.ObjectId[];
  ipAddress?: string;
  userAgent?: string;
}

export function hasPermission(ctx: TenantContext, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

/**
 * Assert that the caller may act in a branch.
 *
 * WHY this is not optional: a manager in Patna must not adjust Ranchi's stock.
 * The branch arrives from the client, so it is checked against the membership on
 * every single operation that names one.
 */
export function assertBranchAccess(ctx: TenantContext, branchId: Types.ObjectId): void {
  if (ctx.allBranches) return;
  const allowed = ctx.branchIds.some((id) => id.equals(branchId));
  if (!allowed) {
    // 404 rather than 403: confirming that a branch exists but is off-limits
    // still leaks the shape of somebody else's business.
    throw AppError.notFound('Branch');
  }
}

/**
 * The branch filter for list queries.
 *
 * Returns `undefined` for users who see everything, so callers can spread it
 * into a filter object without branching.
 */
export function branchFilter(ctx: TenantContext): { branchId: { $in: Types.ObjectId[] } } | null {
  if (ctx.allBranches) return null;
  return { branchId: { $in: ctx.branchIds } };
}

/** Every organization-scoped query starts from this. */
export function orgFilter(ctx: TenantContext): { organizationId: Types.ObjectId } {
  return { organizationId: ctx.organizationId };
}

/**
 * Turn a client-supplied id string into an ObjectId, or reject it.
 *
 * Ids arrive as text from an untrusted source. Casting them at the boundary
 * means a malformed id becomes a clean 400 instead of a Mongoose CastError
 * thrown from somewhere deep in a service.
 */
export function toObjectId(value: string, label = 'id'): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.badRequest(`Invalid ${label}`);
  }
  return new Types.ObjectId(value);
}

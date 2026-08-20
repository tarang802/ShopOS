import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Types } from 'mongoose';
import { MEMBERSHIP_STATUSES, type Permission } from '@shopos/shared';
import { Membership, Role, Session, User } from '../db/models';
import { verifyAccessToken } from '../services/tokenService';
import { AppError } from '../core/AppError';
import type { TenantContext } from '../core/tenantContext';

/**
 * Establish who is asking, on behalf of which business, and what they may do.
 *
 * Everything in the tenant context comes from the token and the database. The
 * request body is never consulted, which is what makes "a client cannot name the
 * organization it wants" a structural fact rather than a rule someone has to
 * remember on every endpoint.
 */

interface CachedMembership {
  expiresAt: number;
  context: Omit<TenantContext, 'ipAddress' | 'userAgent'>;
}

/**
 * Permissions are read from the database, not from the token.
 *
 * WHY: a permission baked into a JWT stays valid until the token expires, so
 * dismissing an employee would leave them with access for another fifteen
 * minutes. Reading from the database means the change lands on their very next
 * request.
 *
 * The cost of that is two extra queries per request, so a short-lived cache sits
 * in front. Fifteen seconds is short enough that a stale entry is not a
 * meaningful exposure, and any deliberate change to a role or membership clears
 * the entry immediately via `invalidateMembership`.
 *
 * NOTE for the deployment phase: this cache lives in one process. With several
 * API instances, an invalidation only clears the instance that handled the
 * change; the others catch up within the TTL. Moving the cache to Redis removes
 * that window.
 */
const membershipCache = new Map<string, CachedMembership>();
const CACHE_TTL_MS = 15_000;

export function invalidateMembership(membershipId: Types.ObjectId | string): void {
  membershipCache.delete(membershipId.toString());
}

/** Called when a role changes, since many memberships may point at it. */
export function invalidateAllMemberships(): void {
  membershipCache.clear();
}

async function loadContext(
  userId: string,
  organizationId: string,
  membershipId: string,
): Promise<Omit<TenantContext, 'ipAddress' | 'userAgent'>> {
  const cached = membershipCache.get(membershipId);
  if (cached && cached.expiresAt > Date.now()) return cached.context;

  const orgId = new Types.ObjectId(organizationId);

  const membership = await Membership.findOne({
    organizationId: orgId,
    _id: new Types.ObjectId(membershipId),
  }).lean();

  if (!membership) throw AppError.unauthenticated('Your access to this business has been removed');
  if (membership.status !== MEMBERSHIP_STATUSES.ACTIVE) {
    throw AppError.forbidden('Your access to this business has been suspended');
  }
  // Guard against a token that names a membership belonging to somebody else.
  if (membership.userId.toString() !== userId) {
    throw AppError.unauthenticated('Invalid session');
  }

  const [user, role] = await Promise.all([
    User.findById(membership.userId).lean(),
    Role.findOne({ organizationId: orgId, _id: membership.roleId }).lean(),
  ]);

  if (!user || !user.isActive) throw AppError.unauthenticated('This account is not active');
  if (!role) throw AppError.forbidden('Your role no longer exists. Ask the owner to reassign it');

  const context: Omit<TenantContext, 'ipAddress' | 'userAgent'> = {
    userId: user._id,
    userName: user.name,
    organizationId: orgId,
    membershipId: membership._id,
    roleId: role._id,
    roleName: role.name,
    permissions: new Set<Permission>(role.permissions),
    allBranches: membership.allBranches,
    branchIds: membership.branchIds,
  };

  membershipCache.set(membershipId, { expiresAt: Date.now() + CACHE_TTL_MS, context });
  return context;
}

export const authenticate: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthenticated('Please sign in to continue');
    }

    const payload = verifyAccessToken(header.slice(7).trim());

    // The session must still exist and not be revoked. This is what makes "log
    // out everywhere" take effect on access tokens that have not yet expired.
    const session = await Session.findById(payload.sid).lean();
    if (!session || session.revokedAt) {
      throw AppError.unauthenticated('Your session has ended. Please sign in again');
    }

    const context = await loadContext(payload.sub, payload.org, payload.mid);

    req.ctx = {
      ...context,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    };

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Read the tenant context inside a controller.
 *
 * Throws rather than returning undefined: reaching a controller without a
 * context means the route was mounted without `authenticate`, which is a
 * programming error and must fail loudly rather than silently running unscoped.
 */
export function requireContext(req: Request): TenantContext {
  if (!req.ctx) throw AppError.unauthenticated('Please sign in to continue');
  return req.ctx;
}

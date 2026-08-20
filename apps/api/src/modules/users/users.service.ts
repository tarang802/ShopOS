import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  AUTH_PROVIDERS,
  MEMBERSHIP_STATUSES,
  SYSTEM_ROLES,
  type MembershipStatus,
  type PaginationQuery,
} from '@shopos/shared';
import { Branch, Membership, Role, User } from '../../db/models';
import { AppError } from '../../core/AppError';
import { safeSearchRegex } from '../../core/listQuery';
import { orgFilter, type TenantContext } from '../../core/tenantContext';
import { recordAudit } from '../../services/auditService';
import { invalidateMembership } from '../../middleware/authenticate';

/**
 * Staff management.
 *
 * A "user of this business" is really a Membership - the join between a global
 * person and one organization. That indirection is what lets an accountant serve
 * two businesses, and what gives branch scoping somewhere to live.
 *
 * Adding staff creates the account directly with a temporary password rather
 * than sending an email invitation. Email delivery is not wired up yet, and a
 * shop owner adding a new employee is usually standing next to them - handing
 * over a password is how it actually happens. A proper invitation flow replaces
 * this once email is configured.
 */

const BCRYPT_COST = 12;

export interface MemberSummary {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  roleId: string;
  roleName: string;
  allBranches: boolean;
  branches: { id: string; name: string }[];
  status: MembershipStatus;
  lastLoginAt?: Date;
  joinedAt?: Date;
}

export async function listMembers(
  ctx: TenantContext,
  query: PaginationQuery,
): Promise<{ items: MemberSummary[]; page: number; limit: number; total: number }> {
  const filter = orgFilter(ctx);

  const [memberships, total] = await Promise.all([
    Membership.find(filter)
      .sort({ createdAt: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Membership.countDocuments(filter),
  ]);

  const userIds = memberships.map((membership) => membership.userId);
  const roleIds = memberships.map((membership) => membership.roleId);
  const branchIds = memberships.flatMap((membership) => membership.branchIds);

  const [users, roles, branches] = await Promise.all([
    User.find({ _id: { $in: userIds } }).lean(),
    Role.find({ ...filter, _id: { $in: roleIds } }).lean(),
    Branch.find({ ...filter, _id: { $in: branchIds } }).lean(),
  ]);

  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const roleById = new Map(roles.map((role) => [role._id.toString(), role]));
  const branchById = new Map(branches.map((branch) => [branch._id.toString(), branch]));

  let items: MemberSummary[] = memberships.flatMap((membership) => {
    const user = userById.get(membership.userId.toString());
    const role = roleById.get(membership.roleId.toString());
    if (!user || !role) return [];

    return [
      {
        membershipId: membership._id.toString(),
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        ...(user.phone ? { phone: user.phone } : {}),
        ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
        roleId: role._id.toString(),
        roleName: role.name,
        allBranches: membership.allBranches,
        branches: membership.branchIds.flatMap((id) => {
          const branch = branchById.get(id.toString());
          return branch ? [{ id: branch._id.toString(), name: branch.name }] : [];
        }),
        status: membership.status,
        ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt } : {}),
        ...(membership.joinedAt ? { joinedAt: membership.joinedAt } : {}),
      },
    ];
  });

  // Filtering happens after assembly because the searchable fields live on the
  // user document while paging is driven by memberships. Staff lists are small
  // - tens of rows, not thousands - so this is honest rather than clever.
  if (query.search) {
    const pattern = safeSearchRegex(query.search);
    items = items.filter((item) => pattern.test(item.name) || pattern.test(item.email));
  }

  return { items, total, page: query.page, limit: query.limit };
}

export interface CreateMemberInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  roleId: string;
  allBranches: boolean;
  branchIds: string[];
}

/** Confirm every branch named actually belongs to this business. */
async function validateBranchIds(
  ctx: TenantContext,
  branchIds: string[],
): Promise<Types.ObjectId[]> {
  if (branchIds.length === 0) return [];

  const ids = branchIds.map((id) => {
    if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('Invalid branch selected');
    return new Types.ObjectId(id);
  });

  // Re-validating ids that arrived from the client is the defence against a
  // caller pasting in a branch id belonging to a different business.
  const found = await Branch.countDocuments({ ...orgFilter(ctx), _id: { $in: ids } });
  if (found !== ids.length) throw AppError.badRequest('One or more branches are not valid');

  return ids;
}

export async function createMember(ctx: TenantContext, input: CreateMemberInput) {
  const email = input.email.toLowerCase().trim();

  const role = await Role.findOne({ ...orgFilter(ctx), _id: input.roleId }).lean();
  if (!role) throw AppError.badRequest('Select a valid role');

  const branchIds = input.allBranches ? [] : await validateBranchIds(ctx, input.branchIds);
  if (!input.allBranches && branchIds.length === 0) {
    throw AppError.badRequest('Select at least one branch, or give access to all branches');
  }

  let user = await User.findOne({ email });

  if (user) {
    const alreadyMember = await Membership.findOne({ ...orgFilter(ctx), userId: user._id }).lean();
    if (alreadyMember) throw AppError.duplicate('This person is already part of your business');
  } else {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
    const [created] = await User.create([
      {
        name: input.name.trim(),
        email,
        phone: input.phone,
        passwordHash,
        authProviders: [AUTH_PROVIDERS.PASSWORD],
      },
    ]);
    if (!created) throw AppError.internal('Could not create the account');
    user = created;
  }

  const [membership] = await Membership.create([
    {
      ...orgFilter(ctx),
      userId: user._id,
      roleId: role._id,
      allBranches: input.allBranches,
      branchIds,
      status: MEMBERSHIP_STATUSES.ACTIVE,
      invitedBy: ctx.userId,
      joinedAt: new Date(),
    },
  ]);
  if (!membership) throw AppError.internal('Could not add the staff member');

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.MEMBERSHIP_CREATED,
    entityType: 'Membership',
    entityId: membership._id,
    entityLabel: user.name,
    after: { email, roleName: role.name, allBranches: input.allBranches },
  });

  return {
    membershipId: membership._id.toString(),
    userId: user._id.toString(),
    name: user.name,
    email: user.email,
    roleName: role.name,
  };
}

export interface UpdateMemberInput {
  roleId?: string;
  allBranches?: boolean;
  branchIds?: string[];
  status?: MembershipStatus;
}

export async function updateMember(
  ctx: TenantContext,
  membershipId: Types.ObjectId,
  input: UpdateMemberInput,
) {
  const membership = await Membership.findOne({ ...orgFilter(ctx), _id: membershipId });
  if (!membership) throw AppError.notFound('Staff member');

  const currentRole = await Role.findOne({ ...orgFilter(ctx), _id: membership.roleId }).lean();

  /**
   * A business must keep at least one active owner. Without this check the last
   * owner could demote or suspend themselves and lock everybody out of user
   * management permanently.
   */
  const isOwner = currentRole?.code === SYSTEM_ROLES.OWNER;
  const losingOwnership =
    isOwner &&
    ((input.roleId && input.roleId !== membership.roleId.toString()) ||
      (input.status && input.status !== MEMBERSHIP_STATUSES.ACTIVE));

  if (losingOwnership) {
    const ownerRoleIds = await Role.find({ ...orgFilter(ctx), code: SYSTEM_ROLES.OWNER })
      .distinct('_id')
      .exec();
    const activeOwners = await Membership.countDocuments({
      ...orgFilter(ctx),
      roleId: { $in: ownerRoleIds },
      status: MEMBERSHIP_STATUSES.ACTIVE,
    });
    if (activeOwners <= 1) {
      throw AppError.businessRule(
        'This is the only active owner. Make someone else an owner first',
      );
    }
  }

  if (input.roleId) {
    const role = await Role.findOne({ ...orgFilter(ctx), _id: input.roleId }).lean();
    if (!role) throw AppError.badRequest('Select a valid role');
    membership.roleId = role._id;
  }

  if (input.allBranches !== undefined) {
    membership.allBranches = input.allBranches;
    if (input.allBranches) membership.branchIds = [];
  }

  if (input.branchIds && !membership.allBranches) {
    membership.branchIds = await validateBranchIds(ctx, input.branchIds);
    if (membership.branchIds.length === 0) {
      throw AppError.badRequest('Select at least one branch, or give access to all branches');
    }
  }

  if (input.status) membership.status = input.status;

  // Bumping the version and clearing the cache is what makes a demotion take
  // effect on the very next request rather than when a token expires.
  membership.permissionsVersion += 1;
  await membership.save();
  invalidateMembership(membership._id);

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.MEMBERSHIP_UPDATED,
    entityType: 'Membership',
    entityId: membership._id,
    after: {
      roleId: membership.roleId.toString(),
      allBranches: membership.allBranches,
      status: membership.status,
    },
  });

  return membership.toObject();
}

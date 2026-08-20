import { Schema, Types, model } from 'mongoose';
import type { MembershipStatus } from '@shopos/shared';
import { MEMBERSHIP_STATUSES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * A membership joins a person to a business, and says what they may do there.
 *
 * WHAT it carries: the organization, the role (hence the permissions), and the
 * branches this person may act in.
 *
 * WHY branch scoping lives here: a manager in Patna must not see Ranchi's stock
 * or sales. Without branches on the membership there is nowhere for that rule to
 * live, and every branch check would be improvised per endpoint.
 *
 * `permissionsVersion` is bumped whenever the role or branches change. The
 * request-time permission cache keys on it, so a demotion takes effect on the
 * very next request instead of whenever the access token happens to expire.
 */

export interface IMembership {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  roleId: Types.ObjectId;
  /**
   * When true this person works across every branch, including branches created
   * later. Owners and admins are set this way; a branch manager is not.
   */
  allBranches: boolean;
  branchIds: Types.ObjectId[];
  status: MembershipStatus;
  invitedBy?: Types.ObjectId;
  joinedAt?: Date;
  permissionsVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const membershipSchema = new Schema<IMembership>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    allBranches: { type: Boolean, required: true, default: false },
    branchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
    status: {
      type: String,
      enum: Object.values(MEMBERSHIP_STATUSES),
      required: true,
      default: MEMBERSHIP_STATUSES.ACTIVE,
    },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date },
    permissionsVersion: { type: Number, required: true, default: 1 },
  },
  { timestamps: true },
);

// One membership per person per business.
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
// Used at login to list the businesses a person belongs to. This one query
// legitimately spans tenants, so it opts out of the guard explicitly.
membershipSchema.index({ userId: 1, status: 1 });
membershipSchema.index({ organizationId: 1, status: 1 });

membershipSchema.plugin(tenantGuard);

export const Membership = model<IMembership>('Membership', membershipSchema);

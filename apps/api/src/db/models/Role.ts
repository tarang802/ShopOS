import { Schema, Types, model } from 'mongoose';
import type { Permission } from '@shopos/shared';
import { ALL_PERMISSIONS } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * A role is a named bundle of permissions, owned by one organization.
 *
 * WHY roles are documents rather than an enum in code: what "Manager" means
 * differs from shop to shop. In one business the manager sets rates; in another
 * only the owner does. Storing roles as editable data means an owner can shape
 * ShopOS to how their business actually runs, without a code change.
 *
 * Authorization always checks permissions, never a role name. Nothing in the
 * codebase asks "is this an OWNER?".
 */

export interface IRole {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  /** Stable identifier for the seeded roles, e.g. OWNER. Blank for custom roles. */
  code?: string;
  description?: string;
  permissions: Permission[];
  /**
   * Seeded roles are marked system roles. They may be edited, but the OWNER role
   * cannot be deleted or stripped of its permissions - otherwise a business can
   * lock itself out of its own account.
   */
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    code: { type: String, trim: true, uppercase: true, maxlength: 40 },
    description: { type: String, trim: true, maxlength: 240 },
    permissions: {
      type: [String],
      enum: ALL_PERMISSIONS as unknown as string[],
      required: true,
      default: [],
    },
    isSystem: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

roleSchema.index({ organizationId: 1, name: 1 }, { unique: true });
roleSchema.index({ organizationId: 1, code: 1 }, { sparse: true });

roleSchema.plugin(tenantGuard);

export const Role = model<IRole>('Role', roleSchema);

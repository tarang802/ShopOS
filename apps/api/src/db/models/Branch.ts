import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * A branch is a physical location that holds stock - a shop, a godown, a
 * counter. Inventory is always "this product, at this branch"; there is no
 * organization-wide stock number, because a pencil in Patna cannot be sold in
 * Ranchi.
 */

export interface IBranch {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  /** Short code used on documents, unique within the organization. */
  code: string;
  phone?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  /** The head location. Exactly one per organization, created at signup. */
  isMain: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const branchSchema = new Schema<IBranch>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 12 },
    phone: { type: String, trim: true, maxlength: 20 },
    addressLine: { type: String, trim: true, maxlength: 240 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    pincode: { type: String, trim: true, maxlength: 10 },
    isMain: { type: Boolean, required: true, default: false },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

// Uniqueness is scoped to the tenant: two different businesses may both have a
// branch coded "MAIN". Every compound index leads with organizationId so one
// large tenant's queries never scan another tenant's documents.
branchSchema.index({ organizationId: 1, code: 1 }, { unique: true });
branchSchema.index({ organizationId: 1, isActive: 1, name: 1 });

branchSchema.plugin(tenantGuard);

export const Branch = model<IBranch>('Branch', branchSchema);

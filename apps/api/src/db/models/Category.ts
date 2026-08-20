import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * How the shop groups its goods - "Pens", "Notebooks", "Switches", "Pipes".
 *
 * One optional level of nesting is supported via `parentId`. Deeper trees are
 * deliberately not modelled: shops that need them are rare, and an arbitrary
 * hierarchy makes every listing screen slower and harder to use for the staff
 * who live in it all day.
 */

export interface ICategory {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  parentId?: Types.ObjectId;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category' },
    description: { type: String, trim: true, maxlength: 240 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

categorySchema.index({ organizationId: 1, name: 1 }, { unique: true });
categorySchema.index({ organizationId: 1, parentId: 1 });

categorySchema.plugin(tenantGuard);

export const Category = model<ICategory>('Category', categorySchema);

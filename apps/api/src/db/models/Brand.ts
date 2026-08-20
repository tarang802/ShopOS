import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * The maker of the goods - Natraj, Camlin, Havells, Finolex.
 *
 * Staff usually search by brand before anything else ("Natraj pencil"), so the
 * brand name is also copied onto each product for fast search results. That
 * denormalization is refreshed by the product service whenever a brand is
 * renamed.
 */

export interface IBrand {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const brandSchema = new Schema<IBrand>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 240 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

brandSchema.index({ organizationId: 1, name: 1 }, { unique: true });

brandSchema.plugin(tenantGuard);

export const Brand = model<IBrand>('Brand', brandSchema);

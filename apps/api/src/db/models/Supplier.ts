import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/** A supplier goods are purchased from. Same shape as Customer, kept separate
 *  because the two sides of a trade relationship are never confused with one
 *  another in the data, even though the fields look similar. */
export interface ISupplier {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  /** Days after receiving goods that the supplier expects to be paid. */
  creditDays: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const supplierSchema = new Schema<ISupplier>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 20 },
    addressLine: { type: String, trim: true, maxlength: 240 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    pincode: { type: String, trim: true, maxlength: 10 },
    creditDays: { type: Number, required: true, default: 0, min: 0, max: 365 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

supplierSchema.index({ organizationId: 1, name: 1 });
supplierSchema.index({ organizationId: 1, isActive: 1, name: 1 });

supplierSchema.plugin(tenantGuard);

export const Supplier = model<ISupplier>('Supplier', supplierSchema);

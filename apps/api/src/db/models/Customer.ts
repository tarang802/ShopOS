import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * A customer the business sells to.
 *
 * Customers are data, not system users - per the product brief, a customer
 * never signs in to ShopOS. `defaultPriceListId` is what lets a counter sale
 * default to the right rate without a staff member having to remember which
 * list a regular buyer is on.
 */

export interface ICustomer {
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
  defaultPriceListId?: Types.ObjectId;
  /** Recorded for reference. No credit-limit enforcement in v1. */
  creditLimitPaise?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
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
    defaultPriceListId: { type: Schema.Types.ObjectId, ref: 'PriceList' },
    creditLimitPaise: { type: Number, min: 0 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

customerSchema.index({ organizationId: 1, name: 1 });
customerSchema.index({ organizationId: 1, phone: 1 });
customerSchema.index({ organizationId: 1, isActive: 1, name: 1 });
customerSchema.index({ name: 'text', phone: 'text' }, { name: 'customer_search' });

customerSchema.plugin(tenantGuard);

export const Customer = model<ICustomer>('Customer', customerSchema);

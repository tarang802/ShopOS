import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * A price list is one way of charging - the counter rate, the bulk rate, the
 * rate for regular trade buyers.
 *
 * Every business already thinks this way: "retail mein 5 rupaye, wholesale mein
 * 4.70". ShopOS just gives that habit a place to live, so the answer is the same
 * whoever is asked.
 *
 * RETAIL, WHOLESALE and DEALER are seeded at signup. Owners may add their own -
 * a "Staff rate" or a "Institution rate" - without any code change.
 */

export interface IPriceList {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  /** Stable identifier for the seeded lists: RETAIL, WHOLESALE, DEALER. */
  code: string;
  description?: string;
  /** Order shown in the UI, so the counter rate always appears first. */
  displayOrder: number;
  /**
   * An inactive list is never used to price anything, and its rates are hidden
   * from the lookup screen. It is not deleted, because past documents were
   * priced from it.
   */
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const priceListSchema = new Schema<IPriceList>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    description: { type: String, trim: true, maxlength: 240 },
    displayOrder: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
    isDefault: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

priceListSchema.index({ organizationId: 1, code: 1 }, { unique: true });
priceListSchema.index({ organizationId: 1, isActive: 1, displayOrder: 1 });

priceListSchema.plugin(tenantGuard);

export const PriceList = model<IPriceList>('PriceList', priceListSchema);

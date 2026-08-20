import { Schema, Types, model } from 'mongoose';
import type { PriceTier } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * One product's rate card under one price list.
 *
 * The quantity slabs are EMBEDDED, and that is the most important modelling
 * decision in the pricing system.
 *
 * WHY embed: the slabs are only valid as a complete set. "1-9, 10-49, 50+" is
 * correct; "1-9, 5-49" is a contradiction that would let the same quantity have
 * two rates. Because the whole set lives in one document, replacing it is a
 * single atomic write - so a half-applied update can never leave overlapping
 * slabs in the database. The invariant is enforced by MongoDB itself, not by
 * hoping the application never crashes mid-update.
 *
 * A slab list is also bounded (a handful of rows) and always read together with
 * the price, which is exactly what embedding is for.
 *
 * Historical documents never read this collection. An invoice from six months
 * ago stores the rate it actually charged, so changing a rate today cannot
 * rewrite the past.
 */

export interface IProductPrice {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  productId: Types.ObjectId;
  priceListId: Types.ObjectId;

  /** Quantity slabs. Validated as a complete, gap-free, non-overlapping set. */
  tiers: PriceTier[];

  /**
   * When this rate card came into force. Recorded for the audit trail and for
   * answering "what did we change on Tuesday?".
   */
  effectiveFrom: Date;

  isActive: boolean;

  /** Who last touched the rate, and when. The first thing an owner asks. */
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const tierSchema = new Schema<PriceTier>(
  {
    minQuantity: { type: Number, required: true, min: 1 },
    // null means the slab is open-ended: the "100+" row at the bottom of the card.
    maxQuantity: { type: Number, default: null, min: 1 },
    pricePaise: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const productPriceSchema = new Schema<IProductPrice>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    priceListId: { type: Schema.Types.ObjectId, ref: 'PriceList', required: true },
    tiers: {
      type: [tierSchema],
      required: true,
      validate: [
        (value: unknown[]) => value.length >= 1 && value.length <= 20,
        'A rate card needs between 1 and 20 slabs',
      ],
    },
    effectiveFrom: { type: Date, required: true, default: () => new Date() },
    isActive: { type: Boolean, required: true, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// One rate card per product per list. The unique index is what actually prevents
// a product ending up with two competing retail cards.
productPriceSchema.index({ organizationId: 1, productId: 1, priceListId: 1 }, { unique: true });
// "Show me every rate on this product" - the product detail screen.
productPriceSchema.index({ organizationId: 1, productId: 1, isActive: 1 });
// "What changed recently?" - the price-updates feed.
productPriceSchema.index({ organizationId: 1, updatedAt: -1 });

productPriceSchema.plugin(tenantGuard);

export const ProductPrice = model<IProductPrice>('ProductPrice', productPriceSchema);

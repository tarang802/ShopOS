import { Schema, Types, model } from 'mongoose';
import type { AdjustmentReason } from '@shopos/shared';
import { ADJUSTMENT_REASONS } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * A correction to recorded stock, with a reason and a name against it.
 *
 * WHY this must exist: physical counts never match the system exactly. Goods get
 * damaged, a box is miscounted, something walks out of the shop. If there is no
 * legitimate way to correct the figure, staff invent illegitimate ones - the
 * classic being a fake sale to make the number agree. An honest adjustment with
 * a reason is far better for the business than a clean-looking sales report.
 *
 * Lines are embedded: a stock-count session covers a bounded set of products and
 * is always read as one document.
 *
 * Each line records the quantity before and after, so the document explains
 * itself years later without replaying the ledger.
 */

export interface IStockAdjustmentItem {
  productId: Types.ObjectId;
  productName: string;
  productSku: string;
  unitSymbol: string;
  /** Recorded stock at the moment the adjustment was applied. */
  previousQuantity: number;
  /** Counted stock, as entered by the staff member. */
  newQuantity: number;
  /** newQuantity - previousQuantity. Stored so the document reads on its own. */
  difference: number;
}

export interface IStockAdjustment {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  /** ADJ-2026-000012. Comes from the atomic counter, never from count()+1. */
  number: string;
  reason: AdjustmentReason;
  notes?: string;
  items: IStockAdjustmentItem[];
  performedBy: Types.ObjectId;
  performedByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const stockAdjustmentItemSchema = new Schema<IStockAdjustmentItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, maxlength: 200 },
    productSku: { type: String, required: true, maxlength: 40 },
    unitSymbol: { type: String, required: true, maxlength: 12 },
    previousQuantity: { type: Number, required: true },
    newQuantity: { type: Number, required: true },
    difference: { type: Number, required: true },
  },
  { _id: false },
);

const stockAdjustmentSchema = new Schema<IStockAdjustment>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    reason: {
      type: String,
      enum: Object.values(ADJUSTMENT_REASONS),
      required: true,
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    items: {
      type: [stockAdjustmentItemSchema],
      required: true,
      validate: [
        (value: unknown[]) => value.length >= 1 && value.length <= 500,
        'An adjustment needs between 1 and 500 lines',
      ],
    },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    performedByName: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: true },
);

stockAdjustmentSchema.index({ organizationId: 1, number: 1 }, { unique: true });
stockAdjustmentSchema.index({ organizationId: 1, branchId: 1, createdAt: -1 });

stockAdjustmentSchema.plugin(tenantGuard);

export const StockAdjustment = model<IStockAdjustment>('StockAdjustment', stockAdjustmentSchema);

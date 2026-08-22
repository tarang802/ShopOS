import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * One delivery received against a purchase order.
 *
 * A purchase order may be received across several of these, on different days,
 * in different quantities - this document is the record of one such event,
 * kept separate from the order itself so the order's own line totals stay
 * about what was asked for, not what has arrived so far.
 */

export interface IGoodsReceiptItem {
  productId: Types.ObjectId;
  productName: string;
  sku: string;
  unitSymbol: string;
  receivedQty: number;
}

export interface IGoodsReceipt {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  purchaseOrderId: Types.ObjectId;
  purchaseOrderNumber: string;
  branchId: Types.ObjectId;
  /** GR-2026-000001, from the atomic counter. */
  number: string;
  receivedDate: Date;
  items: IGoodsReceiptItem[];
  notes?: string;
  receivedBy: Types.ObjectId;
  receivedByName: string;
  createdAt: Date;
}

const goodsReceiptItemSchema = new Schema<IGoodsReceiptItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, maxlength: 200 },
    sku: { type: String, required: true, maxlength: 40 },
    unitSymbol: { type: String, required: true, maxlength: 12 },
    receivedQty: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const goodsReceiptSchema = new Schema<IGoodsReceipt>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    purchaseOrderNumber: { type: String, required: true, maxlength: 40 },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    receivedDate: { type: Date, required: true, default: () => new Date() },
    items: {
      type: [goodsReceiptItemSchema],
      required: true,
      validate: [(value: unknown[]) => value.length >= 1, 'A goods receipt needs at least one line'],
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receivedByName: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

goodsReceiptSchema.index({ organizationId: 1, number: 1 }, { unique: true });
goodsReceiptSchema.index({ organizationId: 1, purchaseOrderId: 1, receivedDate: -1 });

goodsReceiptSchema.plugin(tenantGuard);

export const GoodsReceipt = model<IGoodsReceipt>('GoodsReceipt', goodsReceiptSchema);

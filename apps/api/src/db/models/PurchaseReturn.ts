import { Schema, Types, model } from 'mongoose';
import type { ReturnReason } from '@shopos/shared';
import { RETURN_REASONS } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * Goods sent back to a supplier, and the amount that comes off what is owed.
 *
 * Always against one purchase order, and only for goods that order actually
 * delivered and has not already had returned. Valued at the order's own unit
 * prices - what was agreed - so a later price change cannot change what a return
 * is worth.
 */

export interface IPurchaseReturnItem {
  productId: Types.ObjectId;
  productName: string;
  sku: string;
  unitSymbol: string;
  quantity: number;
  unitPricePaise: number;
  valuePaise: number;
}

export interface IPurchaseReturn {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  /** PR-2026-000001, from the atomic counter. */
  number: string;
  purchaseOrderId: Types.ObjectId;
  purchaseOrderNumber: string;
  supplierId: Types.ObjectId;
  supplierName: string;
  returnDate: Date;
  reason: ReturnReason;
  notes?: string;
  items: IPurchaseReturnItem[];
  /** Total value, credited against what is owed to the supplier. */
  totalPaise: number;
  createdBy: Types.ObjectId;
  createdByName: string;
  createdAt: Date;
}

const purchaseReturnItemSchema = new Schema<IPurchaseReturnItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, maxlength: 200 },
    sku: { type: String, required: true, maxlength: 40 },
    unitSymbol: { type: String, required: true, maxlength: 12 },
    quantity: { type: Number, required: true, min: 0 },
    unitPricePaise: { type: Number, required: true, min: 0 },
    valuePaise: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const purchaseReturnSchema = new Schema<IPurchaseReturn>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    purchaseOrderNumber: { type: String, required: true, maxlength: 40 },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true, maxlength: 160 },
    returnDate: { type: Date, required: true, default: () => new Date() },
    reason: { type: String, enum: Object.values(RETURN_REASONS), required: true },
    notes: { type: String, trim: true, maxlength: 1000 },
    items: {
      type: [purchaseReturnItemSchema],
      required: true,
      validate: [(value: unknown[]) => value.length >= 1, 'A return needs at least one line'],
    },
    totalPaise: { type: Number, required: true, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

purchaseReturnSchema.index({ organizationId: 1, number: 1 }, { unique: true });
purchaseReturnSchema.index({ organizationId: 1, purchaseOrderId: 1 });
purchaseReturnSchema.index({ organizationId: 1, supplierId: 1, returnDate: -1 });
purchaseReturnSchema.index({ organizationId: 1, branchId: 1, returnDate: -1 });

purchaseReturnSchema.plugin(tenantGuard);

export const PurchaseReturn = model<IPurchaseReturn>('PurchaseReturn', purchaseReturnSchema);

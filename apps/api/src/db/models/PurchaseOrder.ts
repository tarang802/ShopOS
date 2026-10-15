import { Schema, Types, model } from 'mongoose';
import type { PurchaseOrderStatus } from '@shopos/shared';
import { PURCHASE_ORDER_STATUSES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * A purchase order is a commitment to buy - it never changes stock by itself.
 *
 * `orderedQty` and `receivedQty` live on the same line so a partial delivery is
 * always visible against what was actually asked for. Stock only moves when a
 * GoodsReceipt is created against this order (see GoodsReceipt.ts and
 * purchasing.service.ts), which is the rule the business brief states
 * explicitly: ordering is not receiving.
 */

export interface IPurchaseOrderItem {
  productId: Types.ObjectId;
  productName: string;
  sku: string;
  unitSymbol: string;
  orderedQty: number;
  receivedQty: number;
  /** How much of what was received has gone back to the supplier. */
  returnedQty: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface IPurchaseOrder {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  branchName: string;
  supplierId: Types.ObjectId;
  supplierName: string;
  /** PO-2026-000001, from the atomic counter. */
  number: string;
  status: PurchaseOrderStatus;
  orderDate: Date;
  items: IPurchaseOrderItem[];
  totalPaise: number;
  /** Value of goods received so far. This, not the order total, is what is owed. */
  receivedValuePaise: number;
  /** Value of goods sent back to the supplier. */
  returnedPaise: number;
  /** Total of supplier payments applied. Moves only through the supplier payments service. */
  paidPaise: number;
  /** The supplier credit days, frozen when the order was written. */
  creditDays: number;
  /** When payment falls due: the earliest delivery plus the credit days. */
  dueDate?: Date;
  notes?: string;
  createdBy: Types.ObjectId;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const purchaseOrderItemSchema = new Schema<IPurchaseOrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, maxlength: 200 },
    sku: { type: String, required: true, maxlength: 40 },
    unitSymbol: { type: String, required: true, maxlength: 12 },
    orderedQty: { type: Number, required: true, min: 0 },
    receivedQty: { type: Number, required: true, default: 0, min: 0 },
    returnedQty: { type: Number, required: true, default: 0, min: 0 },
    unitPricePaise: { type: Number, required: true, min: 0 },
    lineTotalPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const purchaseOrderSchema = new Schema<IPurchaseOrder>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    branchName: { type: String, required: true, maxlength: 120 },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true, maxlength: 160 },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    status: {
      type: String,
      enum: Object.values(PURCHASE_ORDER_STATUSES),
      required: true,
      default: PURCHASE_ORDER_STATUSES.DRAFT,
    },
    orderDate: { type: Date, required: true, default: () => new Date() },
    items: {
      type: [purchaseOrderItemSchema],
      required: true,
      validate: [
        (value: unknown[]) => value.length >= 1 && value.length <= 500,
        'A purchase order needs between 1 and 500 lines',
      ],
    },
    totalPaise: { type: Number, required: true, min: 0 },
    receivedValuePaise: { type: Number, required: true, default: 0, min: 0 },
    returnedPaise: { type: Number, required: true, default: 0, min: 0 },
    paidPaise: { type: Number, required: true, default: 0, min: 0 },
    creditDays: { type: Number, required: true, default: 0, min: 0, max: 365 },
    dueDate: { type: Date },
    notes: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: true },
);

purchaseOrderSchema.index({ organizationId: 1, number: 1 }, { unique: true });
purchaseOrderSchema.index({ organizationId: 1, status: 1, orderDate: -1 });
purchaseOrderSchema.index({ organizationId: 1, supplierId: 1, orderDate: -1 });
// Payables and aging: orders with a due date, soonest first.
purchaseOrderSchema.index({ organizationId: 1, status: 1, dueDate: 1 });

purchaseOrderSchema.plugin(tenantGuard);

export const PurchaseOrder = model<IPurchaseOrder>('PurchaseOrder', purchaseOrderSchema);

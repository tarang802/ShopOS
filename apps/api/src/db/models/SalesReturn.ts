import { Schema, Types, model } from 'mongoose';
import type { PaymentMethod, ReturnReason } from '@shopos/shared';
import { PAYMENT_METHODS, RETURN_REASONS } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * Goods a customer sent back, and the credit given for them (a credit note).
 *
 * A return is always against one invoice and can only take back what that
 * invoice sold and has not already had returned. The credit is worked out from
 * the invoice's frozen line amounts, never from today's rates, so returning an
 * item bought at last month's price credits last month's price.
 *
 * It reduces what the customer owes. If the customer had already paid more than
 * the reduced bill, the difference can be refunded - at the time or afterwards -
 * and each refund is recorded here.
 */

export interface ISalesReturnItem {
  productId: Types.ObjectId;
  productName: string;
  sku: string;
  unitSymbol: string;
  quantity: number;
  /** The rate on the original invoice, frozen. */
  unitPricePaise: number;
  discountPercent: number;
  taxRatePercent: number;
  /** The credit for this line, net of tax. */
  subtotalPaise: number;
  taxPaise: number;
  creditPaise: number;
  /** Whether the goods went back on the shelf. Damaged goods do not. */
  restock: boolean;
}

export interface ISalesReturnRefund {
  amountPaise: number;
  method: PaymentMethod;
  reference?: string;
  refundedAt: Date;
  refundedBy: Types.ObjectId;
  refundedByName: string;
}

export interface ISalesReturn {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  /** SR-2026-000001, from the atomic counter. */
  number: string;
  invoiceId: Types.ObjectId;
  invoiceNumber: string;
  customerId?: Types.ObjectId;
  customerName: string;
  returnDate: Date;
  reason: ReturnReason;
  notes?: string;
  items: ISalesReturnItem[];
  subtotalPaise: number;
  taxPaise: number;
  /** Total credited against the invoice. */
  creditPaise: number;
  /** Total refunded so far. */
  refundedPaise: number;
  refunds: ISalesReturnRefund[];
  createdBy: Types.ObjectId;
  createdByName: string;
  createdAt: Date;
}

const salesReturnItemSchema = new Schema<ISalesReturnItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, maxlength: 200 },
    sku: { type: String, required: true, maxlength: 40 },
    unitSymbol: { type: String, required: true, maxlength: 12 },
    quantity: { type: Number, required: true, min: 0 },
    unitPricePaise: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
    taxRatePercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
    subtotalPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, required: true, min: 0 },
    creditPaise: { type: Number, required: true, min: 0 },
    restock: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

const refundSchema = new Schema<ISalesReturnRefund>(
  {
    amountPaise: { type: Number, required: true, min: 1 },
    method: { type: String, enum: Object.values(PAYMENT_METHODS), required: true },
    reference: { type: String, trim: true, maxlength: 60 },
    refundedAt: { type: Date, required: true, default: () => new Date() },
    refundedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    refundedByName: { type: String, required: true, maxlength: 120 },
  },
  { _id: false },
);

const salesReturnSchema = new Schema<ISalesReturn>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    invoiceNumber: { type: String, required: true, maxlength: 40 },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String, required: true, maxlength: 160 },
    returnDate: { type: Date, required: true, default: () => new Date() },
    reason: { type: String, enum: Object.values(RETURN_REASONS), required: true },
    notes: { type: String, trim: true, maxlength: 1000 },
    items: {
      type: [salesReturnItemSchema],
      required: true,
      validate: [(value: unknown[]) => value.length >= 1, 'A return needs at least one line'],
    },
    subtotalPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, required: true, min: 0 },
    creditPaise: { type: Number, required: true, min: 0 },
    refundedPaise: { type: Number, required: true, default: 0, min: 0 },
    refunds: { type: [refundSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

salesReturnSchema.index({ organizationId: 1, number: 1 }, { unique: true });
salesReturnSchema.index({ organizationId: 1, invoiceId: 1 });
salesReturnSchema.index({ organizationId: 1, branchId: 1, returnDate: -1 });
salesReturnSchema.index({ organizationId: 1, customerId: 1, returnDate: -1 });

salesReturnSchema.plugin(tenantGuard);

export const SalesReturn = model<ISalesReturn>('SalesReturn', salesReturnSchema);

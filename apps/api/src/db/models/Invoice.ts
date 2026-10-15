import { Schema, Types, model } from 'mongoose';
import type { InvoiceStatus } from '@shopos/shared';
import { INVOICE_STATUSES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * A sale, and the historical record that must never change afterwards.
 *
 * This is where §23 of the product brief becomes code: every line freezes the
 * product name, unit, rate, tax and line total as they were at the moment of
 * sale. If the product is renamed or repriced tomorrow, this document is not
 * touched - it stores a snapshot, not a reference the future can rewrite.
 *
 * `productId` is kept alongside the snapshot purely for traceability (so a
 * report can still link back to the product), but every value shown to a human
 * comes from the fields stored on the line, never by re-reading the product.
 */

export interface IInvoiceItem {
  productId: Types.ObjectId;
  productName: string;
  sku: string;
  unitSymbol: string;
  quantity: number;
  /** The rate actually charged, in paise, as resolved by the pricing engine at sale time. */
  unitPricePaise: number;
  /** quantity x unitPricePaise, before any discount. */
  grossPaise: number;
  discountPercent: number;
  discountPaise: number;
  taxRatePercent: number;
  /** gross less discount, before tax. This is what tax is charged on. */
  subtotalPaise: number;
  taxPaise: number;
  /** subtotalPaise + taxPaise. */
  lineTotalPaise: number;
  /**
   * What one unit cost the business when this was sold, frozen like every other
   * value on the line. Only ever shown to people holding `costs:view`.
   */
  unitCostPaise: number;
  /** How much of this line the customer has sent back so far. */
  returnedQty: number;
}

export interface IInvoice {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  branchName: string;
  customerId?: Types.ObjectId;
  customerName: string;
  /** INV-2026-000001, from the atomic counter. */
  number: string;
  status: InvoiceStatus;
  invoiceDate: Date;
  items: IInvoiceItem[];
  /** Sum of line discounts. The subtotal is already net of it. */
  discountPaise: number;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  /** Total of payments applied. Moves only through the payments service. */
  paidPaise: number;
  /** Value of goods sent back, credited against the bill. */
  returnedPaise: number;
  /** Cash given back after a return left the customer overpaid. */
  refundedPaise: number;
  /** When payment is expected: the invoice date plus the customer's credit days. */
  dueDate: Date;
  creditDays: number;
  salesOrderId?: Types.ObjectId;
  salesOrderNumber?: string;
  notes?: string;
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  cancelReason?: string;
  createdBy: Types.ObjectId;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceItemSchema = new Schema<IInvoiceItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, maxlength: 200 },
    sku: { type: String, required: true, maxlength: 40 },
    unitSymbol: { type: String, required: true, maxlength: 12 },
    quantity: { type: Number, required: true, min: 0 },
    unitPricePaise: { type: Number, required: true, min: 0 },
    grossPaise: { type: Number, required: true, default: 0, min: 0 },
    discountPercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
    discountPaise: { type: Number, required: true, default: 0, min: 0 },
    taxRatePercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
    subtotalPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, required: true, min: 0 },
    lineTotalPaise: { type: Number, required: true, min: 0 },
    unitCostPaise: { type: Number, required: true, default: 0, min: 0 },
    returnedQty: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const invoiceSchema = new Schema<IInvoice>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    branchName: { type: String, required: true, maxlength: 120 },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String, required: true, maxlength: 160 },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    status: {
      type: String,
      enum: Object.values(INVOICE_STATUSES),
      required: true,
      default: INVOICE_STATUSES.ISSUED,
    },
    invoiceDate: { type: Date, required: true, default: () => new Date() },
    items: {
      type: [invoiceItemSchema],
      required: true,
      validate: [
        (value: unknown[]) => value.length >= 1 && value.length <= 500,
        'An invoice needs between 1 and 500 lines',
      ],
    },
    discountPaise: { type: Number, required: true, default: 0, min: 0 },
    subtotalPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, required: true, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    paidPaise: { type: Number, required: true, default: 0, min: 0 },
    returnedPaise: { type: Number, required: true, default: 0, min: 0 },
    refundedPaise: { type: Number, required: true, default: 0, min: 0 },
    dueDate: { type: Date, required: true, default: () => new Date() },
    creditDays: { type: Number, required: true, default: 0, min: 0, max: 365 },
    salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder' },
    salesOrderNumber: { type: String, trim: true, maxlength: 40 },
    notes: { type: String, trim: true, maxlength: 1000 },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String, trim: true, maxlength: 240 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: true },
);

invoiceSchema.index({ organizationId: 1, number: 1 }, { unique: true });
invoiceSchema.index({ organizationId: 1, invoiceDate: -1 });
invoiceSchema.index({ organizationId: 1, branchId: 1, invoiceDate: -1 });
invoiceSchema.index({ organizationId: 1, customerId: 1, invoiceDate: -1 });
invoiceSchema.index({ organizationId: 1, status: 1, invoiceDate: -1 });
// Overdue and aging queries: open invoices ordered by when they fell due.
invoiceSchema.index({ organizationId: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ organizationId: 1, salesOrderId: 1 }, { sparse: true });

invoiceSchema.plugin(tenantGuard);

export const Invoice = model<IInvoice>('Invoice', invoiceSchema);

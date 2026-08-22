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
  taxRatePercent: number;
  /** quantity x unitPricePaise, before tax. */
  subtotalPaise: number;
  taxPaise: number;
  /** subtotalPaise + taxPaise. */
  lineTotalPaise: number;
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
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
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
    taxRatePercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
    subtotalPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, required: true, min: 0 },
    lineTotalPaise: { type: Number, required: true, min: 0 },
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
    subtotalPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, required: true, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    paidPaise: { type: Number, required: true, default: 0, min: 0 },
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
invoiceSchema.index({ organizationId: 1, branchId: 1, invoiceDate: -1 });
invoiceSchema.index({ organizationId: 1, customerId: 1, invoiceDate: -1 });
invoiceSchema.index({ organizationId: 1, status: 1, invoiceDate: -1 });

invoiceSchema.plugin(tenantGuard);

export const Invoice = model<IInvoice>('Invoice', invoiceSchema);

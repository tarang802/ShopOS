import { Schema, Types, model } from 'mongoose';
import type { QuotationStatus } from '@shopos/shared';
import { QUOTATION_STATUSES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';
import { documentLineSchema, validLineCount, type IDocumentLine } from './documentLines';

/**
 * An offer. It does not touch stock or money.
 *
 * Its prices are frozen when it is written, so an offer honoured next week charges
 * what was quoted. `status` holds the last thing a person did; EXPIRED is worked
 * out from `validUntil` when it is read, because a quotation does not wait for
 * somebody to mark it stale.
 */

export interface IQuotation {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  branchName: string;
  customerId?: Types.ObjectId;
  customerName: string;
  /** QT-2026-000001, from the atomic counter. */
  number: string;
  status: QuotationStatus;
  quotationDate: Date;
  /** The end of the last day the offer stands. */
  validUntil: Date;
  items: IDocumentLine[];
  discountPaise: number;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  notes?: string;
  terms?: string;
  convertedTo?: {
    type: 'SALES_ORDER' | 'INVOICE';
    id: Types.ObjectId;
    number: string;
  };
  createdBy: Types.ObjectId;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const quotationSchema = new Schema<IQuotation>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    branchName: { type: String, required: true, maxlength: 120 },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String, required: true, maxlength: 160 },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    status: {
      type: String,
      enum: Object.values(QUOTATION_STATUSES),
      required: true,
      default: QUOTATION_STATUSES.DRAFT,
    },
    quotationDate: { type: Date, required: true, default: () => new Date() },
    validUntil: { type: Date, required: true },
    items: {
      type: [documentLineSchema],
      required: true,
      validate: [validLineCount, 'A quotation needs between 1 and 500 lines'],
    },
    discountPaise: { type: Number, required: true, default: 0, min: 0 },
    subtotalPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, required: true, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true, maxlength: 1000 },
    terms: { type: String, trim: true, maxlength: 1000 },
    convertedTo: {
      type: new Schema(
        {
          type: { type: String, enum: ['SALES_ORDER', 'INVOICE'], required: true },
          id: { type: Schema.Types.ObjectId, required: true },
          number: { type: String, required: true, maxlength: 40 },
        },
        { _id: false },
      ),
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: true },
);

quotationSchema.index({ organizationId: 1, number: 1 }, { unique: true });
quotationSchema.index({ organizationId: 1, branchId: 1, quotationDate: -1 });
quotationSchema.index({ organizationId: 1, status: 1, validUntil: 1 });
quotationSchema.index({ organizationId: 1, customerId: 1, quotationDate: -1 });

quotationSchema.plugin(tenantGuard);

export const Quotation = model<IQuotation>('Quotation', quotationSchema);

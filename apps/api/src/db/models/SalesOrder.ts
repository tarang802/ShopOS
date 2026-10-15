import { Schema, Types, model } from 'mongoose';
import type { SalesOrderStatus } from '@shopos/shared';
import { SALES_ORDER_STATUSES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';
import { documentLineFields, validLineCount, type IDocumentLine } from './documentLines';

/**
 * A promise to supply. Like a quotation it moves no stock and no money - the
 * invoice is the event that does both.
 *
 * An order can be invoiced in parts as goods are dispatched, so each line tracks
 * how much has been billed. The order's status follows those quantities rather
 * than being set by hand, which is what keeps "partially invoiced" from ever
 * disagreeing with the invoices behind it.
 */

export interface ISalesOrderItem extends IDocumentLine {
  /** How much of this line has been billed so far. */
  invoicedQty: number;
}

export interface ISalesOrder {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  branchName: string;
  customerId?: Types.ObjectId;
  customerName: string;
  /** SO-2026-000001, from the atomic counter. */
  number: string;
  status: SalesOrderStatus;
  orderDate: Date;
  /** When the customer wants the goods. Informational. */
  expectedDate?: Date;
  items: ISalesOrderItem[];
  discountPaise: number;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  notes?: string;
  quotationId?: Types.ObjectId;
  quotationNumber?: string;
  cancelledAt?: Date;
  cancelReason?: string;
  createdBy: Types.ObjectId;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const salesOrderItemSchema = new Schema<ISalesOrderItem>(
  {
    ...documentLineFields,
    invoicedQty: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const salesOrderSchema = new Schema<ISalesOrder>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    branchName: { type: String, required: true, maxlength: 120 },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String, required: true, maxlength: 160 },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    status: {
      type: String,
      enum: Object.values(SALES_ORDER_STATUSES),
      required: true,
      default: SALES_ORDER_STATUSES.DRAFT,
    },
    orderDate: { type: Date, required: true, default: () => new Date() },
    expectedDate: { type: Date },
    items: {
      type: [salesOrderItemSchema],
      required: true,
      validate: [validLineCount, 'A sales order needs between 1 and 500 lines'],
    },
    discountPaise: { type: Number, required: true, default: 0, min: 0 },
    subtotalPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, required: true, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true, maxlength: 1000 },
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation' },
    quotationNumber: { type: String, trim: true, maxlength: 40 },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true, maxlength: 240 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: true },
);

salesOrderSchema.index({ organizationId: 1, number: 1 }, { unique: true });
salesOrderSchema.index({ organizationId: 1, branchId: 1, orderDate: -1 });
salesOrderSchema.index({ organizationId: 1, status: 1, orderDate: -1 });
salesOrderSchema.index({ organizationId: 1, customerId: 1, orderDate: -1 });

salesOrderSchema.plugin(tenantGuard);

export const SalesOrder = model<ISalesOrder>('SalesOrder', salesOrderSchema);

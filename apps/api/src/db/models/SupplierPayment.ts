import { Schema, Types, model } from 'mongoose';
import type { PaymentMethod, PaymentStatus } from '@shopos/shared';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * Money paid out to a supplier, applied across one or more purchase orders.
 *
 * The mirror of a customer payment, kept as its own collection because the two
 * directions of money are never mixed in the books. A purchase order's paid
 * amount is only ever the sum of these, and like a customer payment one is never
 * deleted - voiding it reverses its effect and leaves the original on record.
 */

export interface ISupplierPaymentAllocation {
  purchaseOrderId: Types.ObjectId;
  purchaseOrderNumber: string;
  amountPaise: number;
}

export interface ISupplierPayment {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  supplierId: Types.ObjectId;
  supplierName: string;
  /** SP-2026-000001, from the atomic counter. */
  number: string;
  amountPaise: number;
  method: PaymentMethod;
  reference?: string;
  paymentDate: Date;
  allocations: ISupplierPaymentAllocation[];
  status: PaymentStatus;
  voidedAt?: Date;
  voidedBy?: Types.ObjectId;
  voidedByName?: string;
  voidReason?: string;
  notes?: string;
  createdBy: Types.ObjectId;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const allocationSchema = new Schema<ISupplierPaymentAllocation>(
  {
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    purchaseOrderNumber: { type: String, required: true, maxlength: 40 },
    amountPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const supplierPaymentSchema = new Schema<ISupplierPayment>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true, maxlength: 160 },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    amountPaise: { type: Number, required: true, min: 0 },
    method: { type: String, enum: Object.values(PAYMENT_METHODS), required: true },
    reference: { type: String, trim: true, maxlength: 60 },
    paymentDate: { type: Date, required: true, default: () => new Date() },
    allocations: {
      type: [allocationSchema],
      required: true,
      validate: [(value: unknown[]) => value.length >= 1, 'A payment needs at least one allocation'],
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUSES),
      required: true,
      default: PAYMENT_STATUSES.RECORDED,
    },
    voidedAt: { type: Date },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidedByName: { type: String, maxlength: 120 },
    voidReason: { type: String, trim: true, maxlength: 240 },
    notes: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: true },
);

supplierPaymentSchema.index({ organizationId: 1, number: 1 }, { unique: true });
supplierPaymentSchema.index({ organizationId: 1, supplierId: 1, paymentDate: -1 });
supplierPaymentSchema.index({ organizationId: 1, 'allocations.purchaseOrderId': 1 });
supplierPaymentSchema.index({ organizationId: 1, branchId: 1, paymentDate: -1 });

supplierPaymentSchema.plugin(tenantGuard);

export const SupplierPayment = model<ISupplierPayment>('SupplierPayment', supplierPaymentSchema);

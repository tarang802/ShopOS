import { Schema, Types, model } from 'mongoose';
import type { PaymentMethod, PaymentStatus } from '@shopos/shared';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * Money received from a customer, allocated across one or more invoices.
 *
 * An invoice's paid amount and outstanding balance are never typed in by hand -
 * they are derived by summing the allocations recorded here, which is what
 * `paymentsService.recordPayment` enforces. This document is the one place
 * that fact is recorded.
 */

export interface IPaymentAllocation {
  invoiceId: Types.ObjectId;
  invoiceNumber: string;
  amountPaise: number;
}

export interface IPayment {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  customerId?: Types.ObjectId;
  customerName: string;
  /** PAY-2026-000001, from the atomic counter. */
  number: string;
  amountPaise: number;
  method: PaymentMethod;
  /** A cheque number, UPI transaction id or bank reference, to trace it later. */
  reference?: string;
  paymentDate: Date;
  allocations: IPaymentAllocation[];
  /**
   * A payment is never deleted. Reversing one marks it VOIDED and takes its
   * amount back off the invoices it settled, leaving the original on record.
   */
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

const allocationSchema = new Schema<IPaymentAllocation>(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    invoiceNumber: { type: String, required: true, maxlength: 40 },
    amountPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const paymentSchema = new Schema<IPayment>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String, required: true, maxlength: 160 },
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

paymentSchema.index({ organizationId: 1, number: 1 }, { unique: true });
paymentSchema.index({ organizationId: 1, branchId: 1, paymentDate: -1 });
paymentSchema.index({ organizationId: 1, status: 1, paymentDate: -1 });
paymentSchema.index({ organizationId: 1, customerId: 1, paymentDate: -1 });
paymentSchema.index({ organizationId: 1, 'allocations.invoiceId': 1 });

paymentSchema.plugin(tenantGuard);

export const Payment = model<IPayment>('Payment', paymentSchema);

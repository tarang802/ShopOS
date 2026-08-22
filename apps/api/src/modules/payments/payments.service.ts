import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  INVOICE_STATUSES,
  sumPaise,
  toSkip,
  type PaginationQuery,
  type PaymentMethod,
} from '@shopos/shared';
import { Customer, Invoice, Payment } from '../../db/models';
import { AppError } from '../../core/AppError';
import { orgFilter, type TenantContext } from '../../core/tenantContext';
import { withTransaction } from '../../db/transaction';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';

/**
 * Payments.
 *
 * An invoice's paid amount is never edited directly - it only ever changes as
 * the sum of allocations recorded here. That is what makes "how much does this
 * customer still owe" a fact derived from a ledger of real payments, rather
 * than a number someone could quietly adjust.
 */

export interface PaymentAllocationInput {
  invoiceId: string;
  amountPaise: number;
}

export interface RecordPaymentInput {
  branchId: string;
  customerId?: string;
  customerName?: string;
  amountPaise: number;
  method: PaymentMethod;
  notes?: string;
  allocations: PaymentAllocationInput[];
}

export async function recordPayment(ctx: TenantContext, input: RecordPaymentInput) {
  const allocatedTotal = sumPaise(input.allocations.map((a) => a.amountPaise));
  if (allocatedTotal > input.amountPaise) {
    throw new AppError(
      422,
      ERROR_CODES.BUSINESS_RULE_VIOLATION,
      `Allocated amount (${allocatedTotal} paise) exceeds the payment amount (${input.amountPaise} paise)`,
    );
  }

  let customerName = input.customerName?.trim();
  let customerId: Types.ObjectId | undefined;
  if (input.customerId) {
    const customer = await Customer.findOne({ ...orgFilter(ctx), _id: input.customerId }).lean();
    if (!customer) throw AppError.badRequest('Select a valid customer');
    customerId = customer._id;
    customerName = customer.name;
  }
  if (!customerName) customerName = 'Walk-in Customer';

  // Every invoice named in an allocation is re-loaded and re-checked here,
  // never trusted from the request - the outstanding balance the client saw a
  // moment ago may already be stale.
  const invoiceIds = input.allocations.map((a) => new Types.ObjectId(a.invoiceId));
  const invoices = await Invoice.find({ ...orgFilter(ctx), _id: { $in: invoiceIds } });
  const invoiceById = new Map(invoices.map((invoice) => [invoice._id.toString(), invoice]));

  if (invoices.length !== new Set(input.allocations.map((a) => a.invoiceId)).size) {
    throw AppError.badRequest('One or more invoices are not valid');
  }

  for (const allocation of input.allocations) {
    const invoice = invoiceById.get(allocation.invoiceId)!;
    if (invoice.status === INVOICE_STATUSES.CANCELLED) {
      throw AppError.businessRule(`Invoice ${invoice.number} is cancelled and cannot receive a payment`);
    }
    const outstanding = invoice.totalPaise - invoice.paidPaise;
    if (allocation.amountPaise > outstanding) {
      throw AppError.businessRule(
        `Allocation of ${allocation.amountPaise} paise to invoice ${invoice.number} exceeds its outstanding balance of ${outstanding} paise`,
      );
    }
  }

  return withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.organizationId, 'PAY', session);

    for (const allocation of input.allocations) {
      const invoice = invoiceById.get(allocation.invoiceId)!;
      invoice.paidPaise += allocation.amountPaise;
      invoice.status =
        invoice.paidPaise >= invoice.totalPaise ? INVOICE_STATUSES.PAID : INVOICE_STATUSES.PARTIALLY_PAID;
      await invoice.save(session ? { session } : {});
    }

    const [payment] = await Payment.create(
      [
        {
          ...orgFilter(ctx),
          branchId: new Types.ObjectId(input.branchId),
          ...(customerId ? { customerId } : {}),
          customerName,
          number,
          amountPaise: input.amountPaise,
          method: input.method,
          allocations: input.allocations.map((a) => ({
            invoiceId: new Types.ObjectId(a.invoiceId),
            invoiceNumber: invoiceById.get(a.invoiceId)!.number,
            amountPaise: a.amountPaise,
          })),
          notes: input.notes,
          createdBy: ctx.userId,
          createdByName: ctx.userName,
        },
      ],
      session ? { session } : {},
    );
    if (!payment) throw AppError.internal('Could not record the payment');

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.PAYMENT_CREATED,
        entityType: 'Payment',
        entityId: payment._id,
        entityLabel: number,
        after: { customerName, amountPaise: input.amountPaise, invoices: input.allocations.length },
      },
      session,
    );

    return payment.toObject();
  });
}

export async function listPayments(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: { customerId?: string },
) {
  const filter: Record<string, unknown> = { ...orgFilter(ctx) };
  if (filters.customerId) filter.customerId = new Types.ObjectId(filters.customerId);

  const [items, total] = await Promise.all([
    Payment.find(filter).sort({ paymentDate: -1 }).skip(toSkip(query.page, query.limit)).limit(query.limit).lean(),
    Payment.countDocuments(filter),
  ]);
  return { items, total, page: query.page, limit: query.limit };
}

/** Invoices with money still owed - what a payment screen picks from. */
export async function listOutstandingInvoices(ctx: TenantContext, customerId?: string) {
  const filter: Record<string, unknown> = {
    ...orgFilter(ctx),
    status: { $in: [INVOICE_STATUSES.ISSUED, INVOICE_STATUSES.PARTIALLY_PAID] },
  };
  if (customerId) filter.customerId = new Types.ObjectId(customerId);

  const invoices = await Invoice.find(filter).sort({ invoiceDate: 1 }).select('-items').lean();
  return invoices.map((invoice) => ({
    ...invoice,
    outstandingPaise: invoice.totalPaise - invoice.paidPaise,
  }));
}

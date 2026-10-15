import { Types, type ClientSession } from 'mongoose';
import {
  AUDIT_ACTIONS,
  INVOICE_STATUSES,
  PAYMENT_STATUSES,
  deriveInvoiceStatus,
  invoiceOutstandingPaise,
  sumPaise,
  toSkip,
  type PaginationQuery,
  type PaymentMethod,
} from '@shopos/shared';
import { Branch, Customer, Invoice, Payment, type IInvoice } from '../../db/models';
import { AppError } from '../../core/AppError';
import { safeSearchRegex } from '../../core/listQuery';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { sessionOption, withTransaction } from '../../db/transaction';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';
import { OPEN_INVOICE_STATUSES } from '../../services/receivablesService';
import { presentInvoice } from '../sales/invoicePresenter';

/**
 * Payments.
 *
 * An invoice's paid amount is never edited directly - it only ever changes as
 * the sum of payments recorded here, and each change is a compare-and-swap: the
 * update names the amounts it read and matches only if nobody has changed them
 * since. That is what makes "how much does this customer still owe" a fact
 * derived from a ledger of real payments, and what stops two staff settling the
 * same bill at the same moment from both succeeding.
 *
 * A payment is never deleted. Voiding one reverses its effect on every invoice
 * it settled and leaves the original on record, so the history of a bill reads
 * "paid, then reversed" rather than silently changing.
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
  reference?: string;
  notes?: string;
  allocations: PaymentAllocationInput[];
}

/** A field that may be missing on invoices written before returns existed. */
function amountMatches(value: number | undefined): number | { $in: (number | null)[] } {
  const amount = value ?? 0;
  return amount === 0 ? { $in: [0, null] } : amount;
}

/**
 * Change an invoice's paid amount only if nothing else has touched it since it
 * was read. Returns without writing when the amounts already agree.
 */
async function swapInvoicePaid(
  ctx: TenantContext,
  invoice: IInvoice,
  newPaidPaise: number,
  session: ClientSession | undefined,
): Promise<void> {
  const status = deriveInvoiceStatus({
    totalPaise: invoice.totalPaise,
    paidPaise: newPaidPaise,
    returnedPaise: invoice.returnedPaise ?? 0,
    refundedPaise: invoice.refundedPaise ?? 0,
  });

  const swapped = await Invoice.updateOne(
    {
      ...orgFilter(ctx),
      _id: invoice._id,
      status: invoice.status,
      paidPaise: invoice.paidPaise,
      returnedPaise: amountMatches(invoice.returnedPaise),
      refundedPaise: amountMatches(invoice.refundedPaise),
    },
    { $set: { paidPaise: newPaidPaise, status } },
    sessionOption(session),
  );

  if (swapped.matchedCount === 0) {
    throw AppError.conflict(
      `Invoice ${invoice.number} was just changed by someone else. Refresh and try again`,
    );
  }
}

/**
 * Record a payment inside a transaction the caller owns.
 *
 * Exported separately from `recordPayment` so an invoice can be created and paid
 * in one transaction - the counter sale where money changes hands on the spot.
 */
export async function recordPaymentInSession(
  ctx: TenantContext,
  input: RecordPaymentInput,
  session: ClientSession | undefined,
) {
  // The branch arrives from the client. It must exist in this business and be
  // one this person may act in - otherwise a payment could be booked against
  // another tenant's branch or a branch the caller has no access to.
  const branchId = new Types.ObjectId(input.branchId);
  assertBranchAccess(ctx, branchId);
  const branch = await Branch.findOne({ ...orgFilter(ctx), _id: branchId })
    .select('_id')
    .session(session ?? null)
    .lean();
  if (!branch) throw AppError.notFound('Branch');

  // Money that is not applied to a bill would simply disappear from the books, so
  // a payment must be fully allocated. Advances are not part of this version.
  const allocatedTotal = sumPaise(input.allocations.map((a) => a.amountPaise));
  if (allocatedTotal !== input.amountPaise) {
    throw AppError.businessRule(
      `The payment of ${input.amountPaise} paise must be fully applied to invoices, but ${allocatedTotal} paise was allocated`,
    );
  }

  const invoiceIdStrings = input.allocations.map((a) => a.invoiceId);
  if (new Set(invoiceIdStrings).size !== invoiceIdStrings.length) {
    throw AppError.badRequest('Each invoice can appear only once in a payment');
  }

  let customerName = input.customerName?.trim();
  let customerId: Types.ObjectId | undefined;
  if (input.customerId) {
    const customer = await Customer.findOne({ ...orgFilter(ctx), _id: input.customerId })
      .session(session ?? null)
      .lean();
    if (!customer) throw AppError.badRequest('Select a valid customer');
    customerId = customer._id;
    customerName = customer.name;
  }
  if (!customerName) customerName = 'Walk-in Customer';

  // Every invoice named in an allocation is re-loaded and re-checked here,
  // never trusted from the request - the outstanding balance the client saw a
  // moment ago may already be stale.
  const invoiceIds = invoiceIdStrings.map((id) => new Types.ObjectId(id));
  const invoices = await Invoice.find({ ...orgFilter(ctx), _id: { $in: invoiceIds } }).session(
    session ?? null,
  );
  if (invoices.length !== invoiceIds.length) {
    throw AppError.badRequest('One or more invoices are not valid');
  }
  const invoiceById = new Map(invoices.map((invoice) => [invoice._id.toString(), invoice]));

  for (const allocation of input.allocations) {
    const invoice = invoiceById.get(allocation.invoiceId)!;
    assertBranchAccess(ctx, invoice.branchId);

    // A payment belongs to one party. Settling Bansal's bill with money recorded
    // under Sharma's name would corrupt both ledgers.
    if ((customerId?.toString() ?? undefined) !== invoice.customerId?.toString()) {
      throw AppError.businessRule(
        `Invoice ${invoice.number} belongs to ${invoice.customerName}, not to the customer on this payment`,
      );
    }

    if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) {
      throw AppError.businessRule(
        `Invoice ${invoice.number} is ${invoice.status.toLowerCase().replace('_', ' ')} and cannot receive a payment`,
      );
    }

    const outstanding = invoiceOutstandingPaise(invoice);
    if (allocation.amountPaise > outstanding) {
      throw AppError.businessRule(
        `Allocation of ${allocation.amountPaise} paise to invoice ${invoice.number} exceeds its outstanding balance of ${outstanding} paise`,
      );
    }
  }

  const number = await nextDocumentNumber(ctx.organizationId, 'PAY', session);

  for (const allocation of input.allocations) {
    const invoice = invoiceById.get(allocation.invoiceId)!;
    await swapInvoicePaid(ctx, invoice, invoice.paidPaise + allocation.amountPaise, session);
  }

  const [payment] = await Payment.create(
    [
      {
        ...orgFilter(ctx),
        branchId,
        ...(customerId ? { customerId } : {}),
        customerName,
        number,
        amountPaise: input.amountPaise,
        method: input.method,
        ...(input.reference ? { reference: input.reference } : {}),
        status: PAYMENT_STATUSES.RECORDED,
        allocations: input.allocations.map((a) => ({
          invoiceId: new Types.ObjectId(a.invoiceId),
          invoiceNumber: invoiceById.get(a.invoiceId)!.number,
          amountPaise: a.amountPaise,
        })),
        ...(input.notes ? { notes: input.notes } : {}),
        createdBy: ctx.userId,
        createdByName: ctx.userName,
      },
    ],
    sessionOption(session),
  );
  if (!payment) throw AppError.internal('Could not record the payment');

  await recordAudit(
    ctx,
    {
      action: AUDIT_ACTIONS.PAYMENT_CREATED,
      entityType: 'Payment',
      entityId: payment._id,
      entityLabel: number,
      branchId,
      after: {
        customerName,
        amountPaise: input.amountPaise,
        method: input.method,
        invoices: input.allocations.length,
      },
    },
    session,
  );

  return payment.toObject();
}

export async function recordPayment(ctx: TenantContext, input: RecordPaymentInput) {
  return withTransaction((session) => recordPaymentInSession(ctx, input, session));
}

/**
 * Reverse a payment: take its amount back off every invoice it settled.
 *
 * The payment stays on record, marked void with who did it and why. An invoice
 * it had settled becomes payable again, which is the point - a cheque that
 * bounced or a payment keyed against the wrong bill is corrected, not hidden.
 */
export async function voidPayment(ctx: TenantContext, paymentId: Types.ObjectId, reason?: string) {
  const payment = await Payment.findOne({ ...orgFilter(ctx), _id: paymentId }).lean();
  if (!payment) throw AppError.notFound('Payment');
  assertBranchAccess(ctx, payment.branchId);

  if (payment.status === PAYMENT_STATUSES.VOIDED) {
    throw AppError.businessRule('This payment has already been voided');
  }

  return withTransaction(async (session) => {
    // Claimed first, with a conditional update, so two people voiding the same
    // payment cannot both take its amount back off the invoices.
    const claimed = await Payment.updateOne(
      { ...orgFilter(ctx), _id: paymentId, status: PAYMENT_STATUSES.RECORDED },
      {
        $set: {
          status: PAYMENT_STATUSES.VOIDED,
          voidedAt: new Date(),
          voidedBy: ctx.userId,
          voidedByName: ctx.userName,
          ...(reason ? { voidReason: reason } : {}),
        },
      },
      sessionOption(session),
    );
    if (claimed.matchedCount === 0) {
      throw AppError.conflict('This payment was just voided by someone else');
    }

    for (const allocation of payment.allocations) {
      const invoice = await Invoice.findOne({ ...orgFilter(ctx), _id: allocation.invoiceId }).session(
        session ?? null,
      );
      if (!invoice) throw AppError.notFound('Invoice');

      const newPaid = invoice.paidPaise - allocation.amountPaise;
      if (newPaid < (invoice.refundedPaise ?? 0)) {
        throw AppError.businessRule(
          `Invoice ${invoice.number} has already had ${invoice.refundedPaise} paise refunded against these payments, so this payment can no longer be voided`,
        );
      }
      await swapInvoicePaid(ctx, invoice, newPaid, session);
    }

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.PAYMENT_VOIDED,
        entityType: 'Payment',
        entityId: payment._id,
        entityLabel: payment.number,
        branchId: payment.branchId,
        after: { amountPaise: payment.amountPaise, reason },
      },
      session,
    );

    const updated = await Payment.findOne({ ...orgFilter(ctx), _id: paymentId })
      .session(session ?? null)
      .lean();
    return updated!;
  });
}

export interface PaymentListFilters {
  customerId?: string;
  status?: string;
  method?: string;
  q?: string;
  from?: Date;
  to?: Date;
  branchId?: string;
}

export async function listPayments(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: PaymentListFilters,
) {
  const filter: Record<string, unknown> = { ...orgFilter(ctx) };

  if (filters.branchId) {
    const branchId = new Types.ObjectId(filters.branchId);
    assertBranchAccess(ctx, branchId);
    filter.branchId = branchId;
  } else if (!ctx.allBranches) {
    filter.branchId = { $in: ctx.branchIds };
  }

  if (filters.customerId) filter.customerId = new Types.ObjectId(filters.customerId);
  if (filters.status) filter.status = filters.status;
  if (filters.method) filter.method = filters.method;
  if (filters.q) {
    const pattern = safeSearchRegex(filters.q);
    filter.$or = [{ number: pattern }, { customerName: pattern }, { reference: pattern }];
  }
  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = filters.from;
    if (filters.to) {
      const end = new Date(filters.to);
      end.setUTCHours(23, 59, 59, 999);
      range.$lte = end;
    }
    filter.paymentDate = range;
  }

  const [items, total] = await Promise.all([
    Payment.find(filter)
      .sort({ paymentDate: -1, _id: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);
  return { items, total, page: query.page, limit: query.limit };
}

export async function getPayment(ctx: TenantContext, paymentId: Types.ObjectId) {
  const payment = await Payment.findOne({ ...orgFilter(ctx), _id: paymentId }).lean();
  if (!payment) throw AppError.notFound('Payment');
  assertBranchAccess(ctx, payment.branchId);
  return payment;
}

/** Invoices with money still owed - what a payment screen picks from. */
export async function listOutstandingInvoices(ctx: TenantContext, customerId?: string) {
  const filter: Record<string, unknown> = {
    ...orgFilter(ctx),
    status: { $in: [INVOICE_STATUSES.ISSUED, INVOICE_STATUSES.PARTIALLY_PAID] },
  };
  if (!ctx.allBranches) filter.branchId = { $in: ctx.branchIds };
  if (customerId) filter.customerId = new Types.ObjectId(customerId);

  const invoices = await Invoice.find(filter).sort({ dueDate: 1, invoiceDate: 1 }).select('-items').lean();
  const now = new Date();
  return invoices.map((invoice) => presentInvoice(ctx, invoice as IInvoice, now));
}

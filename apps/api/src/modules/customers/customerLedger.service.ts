import { Types } from 'mongoose';
import { INVOICE_STATUSES } from '@shopos/shared';
import { Customer, Invoice, Payment, SalesReturn } from '../../db/models';
import { AppError } from '../../core/AppError';
import { orgFilter, type TenantContext } from '../../core/tenantContext';
import {
  buildStatement,
  endOfDay,
  type Statement,
  type StatementEntry,
} from '../../services/statementService';
import {
  OPEN_INVOICE_STATUSES,
  OUTSTANDING_EXPRESSION,
  REFUND_DUE_EXPRESSION,
} from '../../services/receivablesService';
import { PAYMENT_STATUSES } from '@shopos/shared';

/**
 * What one customer owes, and the history behind it.
 *
 * Both views are scoped to the branches the caller works in: a Patna manager
 * looking at a customer who also buys in Ranchi sees only the Patna side.
 */

function branchScope(ctx: TenantContext): Record<string, unknown> {
  return ctx.allBranches ? {} : { branchId: { $in: ctx.branchIds } };
}

async function loadCustomer(ctx: TenantContext, customerId: Types.ObjectId) {
  const customer = await Customer.findOne({ ...orgFilter(ctx), _id: customerId }).lean();
  if (!customer) throw AppError.notFound('Customer');
  return customer;
}

export async function customerSummary(ctx: TenantContext, customerId: Types.ObjectId) {
  const customer = await loadCustomer(ctx, customerId);
  const now = new Date();

  const [open, lifetime] = await Promise.all([
    Invoice.aggregate<{
      outstanding: number;
      overdue: number;
      openCount: number;
      overdueCount: number;
    }>([
      {
        $match: {
          ...orgFilter(ctx),
          ...branchScope(ctx),
          customerId,
          status: { $in: [...OPEN_INVOICE_STATUSES] },
        },
      },
      { $addFields: { owing: OUTSTANDING_EXPRESSION } },
      {
        $group: {
          _id: null,
          outstanding: { $sum: '$owing' },
          openCount: { $sum: 1 },
          overdue: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, '$owing', 0] } },
          overdueCount: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, 1, 0] } },
        },
      },
    ]),
    Invoice.aggregate<{ sales: number; count: number; last: Date; refundDue: number }>([
      {
        $match: {
          ...orgFilter(ctx),
          ...branchScope(ctx),
          customerId,
          status: { $ne: INVOICE_STATUSES.CANCELLED },
        },
      },
      {
        $group: {
          _id: null,
          sales: { $sum: { $subtract: ['$totalPaise', { $ifNull: ['$returnedPaise', 0] }] } },
          refundDue: { $sum: REFUND_DUE_EXPRESSION },
          count: { $sum: 1 },
          last: { $max: '$invoiceDate' },
        },
      },
    ]),
  ]);

  const outstandingPaise = open[0]?.outstanding ?? 0;
  const refundDuePaise = lifetime[0]?.refundDue ?? 0;
  const creditLimitPaise = customer.creditLimitPaise ?? 0;

  return {
    customer,
    outstandingPaise,
    /** Money the customer has paid beyond their reduced bills, owed back to them. */
    refundDuePaise,
    /** Outstanding less what is owed back: the figure the statement closes on. */
    netBalancePaise: outstandingPaise - refundDuePaise,
    overduePaise: open[0]?.overdue ?? 0,
    openInvoices: open[0]?.openCount ?? 0,
    overdueInvoices: open[0]?.overdueCount ?? 0,
    lifetimeSalesPaise: lifetime[0]?.sales ?? 0,
    invoiceCount: lifetime[0]?.count ?? 0,
    lastInvoiceDate: lifetime[0]?.last ?? null,
    creditLimitPaise,
    creditAvailablePaise: creditLimitPaise > 0 ? Math.max(0, creditLimitPaise - outstandingPaise) : null,
  };
}

export async function customerStatement(
  ctx: TenantContext,
  customerId: Types.ObjectId,
  range: { from?: Date; to?: Date },
): Promise<{ customer: { _id: Types.ObjectId; name: string } } & Statement> {
  const customer = await loadCustomer(ctx, customerId);
  const to = range.to ? endOfDay(range.to) : new Date();
  const scope = { ...orgFilter(ctx), ...branchScope(ctx), customerId };

  const [invoices, payments, returns] = await Promise.all([
    Invoice.find({ ...scope, status: { $ne: INVOICE_STATUSES.CANCELLED }, invoiceDate: { $lte: to } })
      .select('number invoiceDate totalPaise dueDate')
      .limit(5000)
      .lean(),
    Payment.find({ ...scope, status: PAYMENT_STATUSES.RECORDED, paymentDate: { $lte: to } })
      .select('number paymentDate amountPaise method reference')
      .limit(5000)
      .lean(),
    SalesReturn.find({ ...scope, returnDate: { $lte: to } })
      .select('number returnDate creditPaise invoiceNumber refunds')
      .limit(5000)
      .lean(),
  ]);

  const entries: StatementEntry[] = [
    ...invoices.map((invoice) => ({
      date: invoice.invoiceDate,
      type: 'INVOICE',
      reference: invoice.number,
      description: 'Sale',
      debitPaise: invoice.totalPaise,
      creditPaise: 0,
      link: { type: 'invoice', id: invoice._id.toString() },
    })),
    ...payments.map((payment) => ({
      date: payment.paymentDate,
      type: 'PAYMENT',
      reference: payment.number,
      description: `Payment received (${payment.method.toLowerCase().replace('_', ' ')})${payment.reference ? ` ref ${payment.reference}` : ''}`,
      debitPaise: 0,
      creditPaise: payment.amountPaise,
      link: { type: 'payment', id: payment._id.toString() },
    })),
    ...returns.flatMap((salesReturn) => [
      {
        date: salesReturn.returnDate,
        type: 'RETURN',
        reference: salesReturn.number,
        description: `Goods returned against ${salesReturn.invoiceNumber}`,
        debitPaise: 0,
        creditPaise: salesReturn.creditPaise,
        link: { type: 'return', id: salesReturn._id.toString() },
      },
      ...salesReturn.refunds.map((refund) => ({
        date: refund.refundedAt,
        type: 'REFUND',
        reference: salesReturn.number,
        description: `Refund given (${refund.method.toLowerCase().replace('_', ' ')})`,
        debitPaise: refund.amountPaise,
        creditPaise: 0,
        link: { type: 'return', id: salesReturn._id.toString() },
      })),
    ]),
  ];

  return {
    customer: { _id: customer._id, name: customer.name },
    ...buildStatement(entries, { ...(range.from ? { from: range.from } : {}), to }),
  };
}

/** What each of these customers owes, for showing a balance beside every name in a list. */
export async function outstandingByCustomer(
  ctx: TenantContext,
  customerIds: Types.ObjectId[],
): Promise<Map<string, number>> {
  if (customerIds.length === 0) return new Map();

  const rows = await Invoice.aggregate<{ _id: Types.ObjectId; owing: number }>([
    {
      $match: {
        ...orgFilter(ctx),
        ...branchScope(ctx),
        customerId: { $in: customerIds },
        status: { $in: [...OPEN_INVOICE_STATUSES] },
      },
    },
    { $group: { _id: '$customerId', owing: { $sum: OUTSTANDING_EXPRESSION } } },
  ]);

  return new Map(rows.map((row) => [row._id.toString(), row.owing]));
}

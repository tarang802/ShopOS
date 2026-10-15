import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  INVENTORY_TRANSACTION_TYPES,
  INVOICE_STATUSES,
  deriveInvoiceStatus,
  invoiceRefundDuePaise,
  proportionalPaise,
  sumPaise,
  toSkip,
  type PaginationQuery,
  type PaymentMethod,
  type ReturnReason,
} from '@shopos/shared';
import { Invoice, SalesReturn, type ISalesReturnItem } from '../../db/models';
import { AppError } from '../../core/AppError';
import { organizationDayRange } from '../../core/calendar';
import { safeSearchRegex } from '../../core/listQuery';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { sessionOption, withTransaction } from '../../db/transaction';
import { applyMovement } from '../../services/inventoryService';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';
import { amountMatches } from '../../services/receivablesService';
import { QUANTITY_EPSILON } from './salesOrderLedger';

/**
 * Sales returns: goods back, credit given.
 *
 * The credit comes from the invoice's own frozen amounts, never today's rates,
 * and is worked out cumulatively. Returning a line of 7 in three goes credits the
 * line's total exactly once across the three returns, because each return is the
 * difference between "credit for everything returned so far" and "credit for
 * everything before this" - rounding can never leave a paisa behind.
 *
 * Like a payment, a return changes the invoice only through a compare-and-swap:
 * it names the amounts it read and matches only if nobody moved them since.
 */

export interface SalesReturnInput {
  invoiceId: string;
  reason: ReturnReason;
  notes?: string;
  items: { productId: string; quantity: number; restock?: boolean }[];
  /** Cash given back now. Only possible when the customer has paid more than the reduced bill. */
  refund?: { method: PaymentMethod; amountPaise: number; reference?: string };
}

export async function createSalesReturn(ctx: TenantContext, input: SalesReturnInput) {
  const invoiceId = new Types.ObjectId(input.invoiceId);

  return withTransaction(async (session) => {
    const invoice = await Invoice.findOne({ ...orgFilter(ctx), _id: invoiceId }).session(
      session ?? null,
    );
    if (!invoice) throw AppError.notFound('Invoice');
    assertBranchAccess(ctx, invoice.branchId);

    if (invoice.status === INVOICE_STATUSES.CANCELLED) {
      throw AppError.businessRule('A cancelled invoice has nothing to return');
    }

    const lineByProduct = new Map(invoice.items.map((line) => [line.productId.toString(), line]));

    const returnItems: (ISalesReturnItem & { newReturnedQty: number })[] = [];
    for (const item of input.items) {
      const line = lineByProduct.get(item.productId);
      if (!line) throw AppError.badRequest('One or more products are not on this invoice');

      const alreadyReturned = line.returnedQty ?? 0;
      const remaining = line.quantity - alreadyReturned;
      if (item.quantity > remaining + QUANTITY_EPSILON) {
        throw AppError.businessRule(
          `Only ${remaining} ${line.unitSymbol} of ${line.productName} can still be returned on this invoice`,
        );
      }

      const newReturnedQty = alreadyReturned + item.quantity;
      const subtotalPaise =
        proportionalPaise(line.subtotalPaise, newReturnedQty, line.quantity) -
        proportionalPaise(line.subtotalPaise, alreadyReturned, line.quantity);
      const taxPaise =
        proportionalPaise(line.taxPaise, newReturnedQty, line.quantity) -
        proportionalPaise(line.taxPaise, alreadyReturned, line.quantity);

      returnItems.push({
        productId: line.productId,
        productName: line.productName,
        sku: line.sku,
        unitSymbol: line.unitSymbol,
        quantity: item.quantity,
        unitPricePaise: line.unitPricePaise,
        discountPercent: line.discountPercent ?? 0,
        taxRatePercent: line.taxRatePercent,
        subtotalPaise,
        taxPaise,
        creditPaise: subtotalPaise + taxPaise,
        restock: item.restock ?? true,
        newReturnedQty,
      });
    }

    const creditPaise = sumPaise(returnItems.map((item) => item.creditPaise));
    const newReturned = (invoice.returnedPaise ?? 0) + creditPaise;
    const refundPaise = input.refund?.amountPaise ?? 0;

    const refundDue = invoiceRefundDuePaise({
      totalPaise: invoice.totalPaise,
      paidPaise: invoice.paidPaise,
      returnedPaise: newReturned,
      refundedPaise: invoice.refundedPaise ?? 0,
    });
    if (refundPaise > refundDue) {
      throw AppError.businessRule(
        `A refund of ${refundPaise} paise is more than the ${refundDue} paise this customer is owed back`,
      );
    }

    const newRefunded = (invoice.refundedPaise ?? 0) + refundPaise;
    const status = deriveInvoiceStatus({
      totalPaise: invoice.totalPaise,
      paidPaise: invoice.paidPaise,
      returnedPaise: newReturned,
      refundedPaise: newRefunded,
    });

    // One conditional update changes everything on the invoice together. It
    // matches only if the money amounts and status are still what this return
    // read, so two returns racing on the same invoice cannot both credit the
    // same goods.
    const inc: Record<string, number> = { returnedPaise: creditPaise, refundedPaise: refundPaise };
    const arrayFilters: Record<string, unknown>[] = [];
    returnItems.forEach((item, index) => {
      inc[`items.$[line${index}].returnedQty`] = item.quantity;
      arrayFilters.push({ [`line${index}.productId`]: item.productId });
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
      { $inc: inc, $set: { status } },
      { arrayFilters, ...sessionOption(session) },
    );
    if (swapped.matchedCount === 0) {
      throw AppError.conflict(
        `Invoice ${invoice.number} was just changed by someone else. Refresh and try again`,
      );
    }

    const number = await nextDocumentNumber(ctx.organizationId, 'SR', session);
    const returnId = new Types.ObjectId();

    for (const item of returnItems) {
      if (!item.restock) continue;
      await applyMovement(
        ctx,
        {
          branchId: invoice.branchId,
          productId: item.productId,
          type: INVENTORY_TRANSACTION_TYPES.SALE_RETURN,
          quantity: item.quantity,
          referenceType: 'SALES_RETURN',
          referenceId: returnId,
          referenceNumber: number,
          reason: input.reason,
        },
        { allowNegative: true },
        session,
      );
    }

    const [salesReturn] = await SalesReturn.create(
      [
        {
          _id: returnId,
          ...orgFilter(ctx),
          branchId: invoice.branchId,
          number,
          invoiceId: invoice._id,
          invoiceNumber: invoice.number,
          ...(invoice.customerId ? { customerId: invoice.customerId } : {}),
          customerName: invoice.customerName,
          reason: input.reason,
          ...(input.notes ? { notes: input.notes } : {}),
          items: returnItems.map(({ newReturnedQty: _unused, ...item }) => item),
          subtotalPaise: sumPaise(returnItems.map((item) => item.subtotalPaise)),
          taxPaise: sumPaise(returnItems.map((item) => item.taxPaise)),
          creditPaise,
          refundedPaise: refundPaise,
          refunds:
            input.refund && refundPaise > 0
              ? [
                  {
                    amountPaise: refundPaise,
                    method: input.refund.method,
                    ...(input.refund.reference ? { reference: input.refund.reference } : {}),
                    refundedAt: new Date(),
                    refundedBy: ctx.userId,
                    refundedByName: ctx.userName,
                  },
                ]
              : [],
          createdBy: ctx.userId,
          createdByName: ctx.userName,
        },
      ],
      sessionOption(session),
    );
    if (!salesReturn) throw AppError.internal('Could not record the return');

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.SALES_RETURN_CREATED,
        entityType: 'SalesReturn',
        entityId: returnId,
        entityLabel: number,
        branchId: invoice.branchId,
        after: {
          invoice: invoice.number,
          creditPaise,
          refundedPaise: refundPaise,
          reason: input.reason,
          lines: returnItems.length,
        },
      },
      session,
    );

    return salesReturn.toObject();
  });
}

/**
 * Hand money back for a return that left the customer overpaid.
 *
 * Bounded by what the invoice actually owes back, so a refund can never exceed
 * what the customer paid over the reduced bill.
 */
export async function refundSalesReturn(
  ctx: TenantContext,
  returnId: Types.ObjectId,
  input: { method: PaymentMethod; amountPaise: number; reference?: string },
) {
  const found = await SalesReturn.findOne({ ...orgFilter(ctx), _id: returnId }).lean();
  if (!found) throw AppError.notFound('Return');
  assertBranchAccess(ctx, found.branchId);

  return withTransaction(async (session) => {
    const invoice = await Invoice.findOne({ ...orgFilter(ctx), _id: found.invoiceId }).session(
      session ?? null,
    );
    if (!invoice) throw AppError.notFound('Invoice');

    const refundDue = invoiceRefundDuePaise({
      totalPaise: invoice.totalPaise,
      paidPaise: invoice.paidPaise,
      returnedPaise: invoice.returnedPaise ?? 0,
      refundedPaise: invoice.refundedPaise ?? 0,
    });
    if (input.amountPaise > refundDue) {
      throw AppError.businessRule(
        `This customer is owed ${refundDue} paise back on invoice ${invoice.number}, not ${input.amountPaise}`,
      );
    }

    const newRefunded = (invoice.refundedPaise ?? 0) + input.amountPaise;
    const swapped = await Invoice.updateOne(
      {
        ...orgFilter(ctx),
        _id: invoice._id,
        status: invoice.status,
        paidPaise: invoice.paidPaise,
        returnedPaise: amountMatches(invoice.returnedPaise),
        refundedPaise: amountMatches(invoice.refundedPaise),
      },
      {
        $set: {
          refundedPaise: newRefunded,
          status: deriveInvoiceStatus({
            totalPaise: invoice.totalPaise,
            paidPaise: invoice.paidPaise,
            returnedPaise: invoice.returnedPaise ?? 0,
            refundedPaise: newRefunded,
          }),
        },
      },
      sessionOption(session),
    );
    if (swapped.matchedCount === 0) {
      throw AppError.conflict('This invoice was just changed by someone else. Refresh and try again');
    }

    const updated = await SalesReturn.findOneAndUpdate(
      { ...orgFilter(ctx), _id: returnId },
      {
        $inc: { refundedPaise: input.amountPaise },
        $push: {
          refunds: {
            amountPaise: input.amountPaise,
            method: input.method,
            ...(input.reference ? { reference: input.reference } : {}),
            refundedAt: new Date(),
            refundedBy: ctx.userId,
            refundedByName: ctx.userName,
          },
        },
      },
      { returnDocument: 'after', ...sessionOption(session) },
    ).lean();

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.SALES_RETURN_CREATED,
        entityType: 'SalesReturn',
        entityId: returnId,
        entityLabel: found.number,
        branchId: found.branchId,
        after: { refundedPaise: input.amountPaise, method: input.method },
      },
      session,
    );

    return updated!;
  });
}

export interface SalesReturnListFilters {
  branchId?: string;
  customerId?: string;
  invoiceId?: string;
  q?: string;
  from?: Date;
  to?: Date;
}

export async function listSalesReturns(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: SalesReturnListFilters,
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
  if (filters.invoiceId) filter.invoiceId = new Types.ObjectId(filters.invoiceId);
  if (filters.q) {
    const pattern = safeSearchRegex(filters.q);
    filter.$or = [{ number: pattern }, { invoiceNumber: pattern }, { customerName: pattern }];
  }
  const dateRange = await organizationDayRange(ctx, filters.from, filters.to);
  if (dateRange) filter.returnDate = dateRange;

  const [items, total] = await Promise.all([
    SalesReturn.find(filter)
      .sort({ returnDate: -1, _id: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .select('-items')
      .lean(),
    SalesReturn.countDocuments(filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function getSalesReturn(ctx: TenantContext, returnId: Types.ObjectId) {
  const found = await SalesReturn.findOne({ ...orgFilter(ctx), _id: returnId }).lean();
  if (!found) throw AppError.notFound('Return');
  assertBranchAccess(ctx, found.branchId);
  return found;
}

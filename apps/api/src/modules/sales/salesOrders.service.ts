import { Types, type ClientSession } from 'mongoose';
import {
  AUDIT_ACTIONS,
  SALES_ORDER_STATUSES,
  toSkip,
  type PaginationQuery,
} from '@shopos/shared';
import { Branch, Customer, Invoice, SalesOrder, type ISalesOrder } from '../../db/models';
import { AppError } from '../../core/AppError';
import { safeSearchRegex } from '../../core/listQuery';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { sessionOption, withTransaction } from '../../db/transaction';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';
import { buildDocumentLines, toFrozenLine } from './documentTotals';
import {
  persistInvoice,
  prepareInvoiceFromLines,
  priceDocumentLines,
  type FrozenLine,
  type InvoiceLineInput,
} from './invoices.service';
import { presentInvoice } from './invoicePresenter';
import { QUANTITY_EPSILON, refreshOrderStatus } from './salesOrderLedger';

/**
 * Sales orders: a promise to supply, invoiced as the goods go out.
 *
 * The order itself moves no stock and no money. Each time part of it is invoiced,
 * the quantity is claimed on the order with a conditional update and the invoice
 * is written in the same transaction - so two people invoicing the last of the
 * same order at once cannot both bill it, and an order can never have been
 * invoiced for more than it asked for.
 */

export interface SalesOrderHeaderInput {
  branchId: string;
  customerId?: string;
  customerName?: string;
  expectedDate?: Date;
  notes?: string;
}

export interface CreateSalesOrderInput extends SalesOrderHeaderInput {
  items: InvoiceLineInput[];
}

export async function resolveParties(ctx: TenantContext, header: SalesOrderHeaderInput) {
  const branchId = new Types.ObjectId(header.branchId);
  assertBranchAccess(ctx, branchId);

  const branch = await Branch.findOne({ ...orgFilter(ctx), _id: branchId }).select('name').lean();
  if (!branch) throw AppError.notFound('Branch');

  let customerName = header.customerName?.trim();
  let customerId: Types.ObjectId | undefined;
  if (header.customerId) {
    const customer = await Customer.findOne({ ...orgFilter(ctx), _id: header.customerId })
      .select('name isActive')
      .lean();
    if (!customer) throw AppError.badRequest('Select a valid customer');
    if (!customer.isActive) throw AppError.badRequest(`${customer.name} is marked inactive`);
    customerId = customer._id;
    customerName = customer.name;
  }

  return {
    branchId,
    branchName: branch.name,
    ...(customerId ? { customerId } : {}),
    customerName: customerName || 'Walk-in Customer',
  };
}

/**
 * Write an order from lines whose terms are already settled.
 *
 * Shared by direct creation and by converting a quotation, so an order made either
 * way is the same document.
 */
export async function createSalesOrderInSession(
  ctx: TenantContext,
  header: SalesOrderHeaderInput,
  lines: FrozenLine[],
  extras: { quotationId?: Types.ObjectId; quotationNumber?: string },
  session: ClientSession | undefined,
) {
  const parties = await resolveParties(ctx, header);
  const totals = buildDocumentLines(lines);
  const number = await nextDocumentNumber(ctx.organizationId, 'SO', session);

  const [order] = await SalesOrder.create(
    [
      {
        ...orgFilter(ctx),
        ...parties,
        number,
        status: SALES_ORDER_STATUSES.DRAFT,
        ...(header.expectedDate ? { expectedDate: header.expectedDate } : {}),
        items: totals.items.map((item) => ({ ...item, invoicedQty: 0 })),
        discountPaise: totals.discountPaise,
        subtotalPaise: totals.subtotalPaise,
        taxPaise: totals.taxPaise,
        totalPaise: totals.totalPaise,
        ...(header.notes ? { notes: header.notes } : {}),
        ...(extras.quotationId ? { quotationId: extras.quotationId } : {}),
        ...(extras.quotationNumber ? { quotationNumber: extras.quotationNumber } : {}),
        createdBy: ctx.userId,
        createdByName: ctx.userName,
      },
    ],
    sessionOption(session),
  );
  if (!order) throw AppError.internal('Could not create the sales order');

  await recordAudit(
    ctx,
    {
      action: AUDIT_ACTIONS.SALES_ORDER_CREATED,
      entityType: 'SalesOrder',
      entityId: order._id,
      entityLabel: number,
      branchId: order.branchId,
      after: {
        customerName: order.customerName,
        totalPaise: order.totalPaise,
        lines: order.items.length,
        ...(extras.quotationNumber ? { fromQuotation: extras.quotationNumber } : {}),
      },
    },
    session,
  );

  return order;
}

export async function createSalesOrder(ctx: TenantContext, input: CreateSalesOrderInput) {
  const lines = await priceDocumentLines(ctx, input.items);
  const order = await withTransaction((session) =>
    createSalesOrderInSession(ctx, input, lines, {}, session),
  );
  return order.toObject();
}

async function loadOrder(ctx: TenantContext, id: Types.ObjectId) {
  const order = await SalesOrder.findOne({ ...orgFilter(ctx), _id: id });
  if (!order) throw AppError.notFound('Sales order');
  assertBranchAccess(ctx, order.branchId);
  return order;
}

/** Replace a draft order's lines and header. Once confirmed, an order is a promise and stays as made. */
export async function updateSalesOrder(
  ctx: TenantContext,
  id: Types.ObjectId,
  input: CreateSalesOrderInput,
) {
  const order = await loadOrder(ctx, id);
  if (order.status !== SALES_ORDER_STATUSES.DRAFT) {
    throw AppError.businessRule('Only a draft sales order can be edited');
  }

  const [parties, lines] = await Promise.all([
    resolveParties(ctx, input),
    priceDocumentLines(ctx, input.items),
  ]);
  const totals = buildDocumentLines(lines);

  const updated = await SalesOrder.findOneAndUpdate(
    { ...orgFilter(ctx), _id: id, status: SALES_ORDER_STATUSES.DRAFT },
    {
      $set: {
        ...parties,
        items: totals.items.map((item) => ({ ...item, invoicedQty: 0 })),
        discountPaise: totals.discountPaise,
        subtotalPaise: totals.subtotalPaise,
        taxPaise: totals.taxPaise,
        totalPaise: totals.totalPaise,
        notes: input.notes,
        expectedDate: input.expectedDate,
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw AppError.conflict('This sales order was just changed by someone else');

  return updated;
}

export async function confirmSalesOrder(ctx: TenantContext, id: Types.ObjectId) {
  const order = await loadOrder(ctx, id);

  const updated = await SalesOrder.findOneAndUpdate(
    { ...orgFilter(ctx), _id: id, status: SALES_ORDER_STATUSES.DRAFT },
    { $set: { status: SALES_ORDER_STATUSES.CONFIRMED } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) {
    throw AppError.businessRule(`This sales order is ${order.status.toLowerCase().replace('_', ' ')}, not a draft`);
  }

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.SALES_ORDER_CONFIRMED,
    entityType: 'SalesOrder',
    entityId: updated._id,
    entityLabel: updated.number,
    branchId: updated.branchId,
  });

  return updated;
}

/** An order that has been billed in any part cannot be cancelled - cancel its invoices instead. */
export async function cancelSalesOrder(ctx: TenantContext, id: Types.ObjectId, reason?: string) {
  const order = await loadOrder(ctx, id);
  if (order.status === SALES_ORDER_STATUSES.CANCELLED) {
    throw AppError.businessRule('This sales order is already cancelled');
  }
  if (order.items.some((item) => item.invoicedQty > QUANTITY_EPSILON)) {
    throw AppError.businessRule(
      'Part of this order has already been invoiced. Cancel those invoices first',
    );
  }

  const updated = await SalesOrder.findOneAndUpdate(
    {
      ...orgFilter(ctx),
      _id: id,
      status: { $in: [SALES_ORDER_STATUSES.DRAFT, SALES_ORDER_STATUSES.CONFIRMED] },
    },
    {
      $set: {
        status: SALES_ORDER_STATUSES.CANCELLED,
        cancelledAt: new Date(),
        ...(reason ? { cancelReason: reason } : {}),
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw AppError.conflict('This sales order was just changed by someone else');

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.SALES_ORDER_CANCELLED,
    entityType: 'SalesOrder',
    entityId: updated._id,
    entityLabel: updated.number,
    branchId: updated.branchId,
    after: { reason },
  });

  return updated;
}

export interface InvoiceSalesOrderInput {
  /** The quantities to bill now. Leave out to invoice everything still outstanding. */
  items?: { productId: string; quantity: number }[];
  creditDays?: number;
  notes?: string;
}

/**
 * Invoice all or part of an order.
 *
 * The invoice uses the order's frozen rates - the promise is honoured at the
 * price that was agreed, whatever the rate card says today.
 */
export async function invoiceSalesOrder(
  ctx: TenantContext,
  id: Types.ObjectId,
  input: InvoiceSalesOrderInput,
) {
  const order = await loadOrder(ctx, id);
  if (
    order.status !== SALES_ORDER_STATUSES.CONFIRMED &&
    order.status !== SALES_ORDER_STATUSES.PARTIALLY_INVOICED
  ) {
    throw AppError.businessRule(
      order.status === SALES_ORDER_STATUSES.DRAFT
        ? 'Confirm the sales order before invoicing it'
        : `This sales order is ${order.status.toLowerCase().replace('_', ' ')} and cannot be invoiced`,
    );
  }

  const requested = new Map<string, number>();
  if (input.items?.length) {
    for (const item of input.items) {
      if (requested.has(item.productId)) {
        throw AppError.badRequest('Each product can appear only once');
      }
      requested.set(item.productId, item.quantity);
    }
  }

  const toBill: { line: ISalesOrder['items'][number]; quantity: number }[] = [];
  for (const line of order.items) {
    const outstanding = line.quantity - line.invoicedQty;
    const quantity = input.items?.length
      ? (requested.get(line.productId.toString()) ?? 0)
      : outstanding;
    if (quantity <= QUANTITY_EPSILON) continue;

    if (quantity > outstanding + QUANTITY_EPSILON) {
      throw AppError.businessRule(
        `Only ${outstanding} ${line.unitSymbol} of ${line.productName} is left to invoice on this order`,
      );
    }
    toBill.push({ line, quantity });
  }

  if (input.items?.length) {
    const known = new Set(order.items.map((line) => line.productId.toString()));
    if ([...requested.keys()].some((productId) => !known.has(productId))) {
      throw AppError.badRequest('One or more products are not on this sales order');
    }
  }
  if (toBill.length === 0) throw AppError.badRequest('There is nothing left to invoice on this order');

  const prepared = await prepareInvoiceFromLines(
    ctx,
    {
      branchId: order.branchId.toString(),
      ...(order.customerId ? { customerId: order.customerId.toString() } : {}),
      customerName: order.customerName,
      ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
      ...(input.notes ? { notes: input.notes } : order.notes ? { notes: order.notes } : {}),
    },
    toBill.map(({ line, quantity }) => toFrozenLine(line, quantity)),
  );

  const invoiceId = await withTransaction(async (session) => {
    for (const { line, quantity } of toBill) {
      // The quantity is claimed on the order before the invoice is written. If
      // someone else billed the same goods a moment ago, no line matches and
      // this refuses - nothing has been taken from stock yet.
      const claimed = await SalesOrder.updateOne(
        {
          ...orgFilter(ctx),
          _id: order._id,
          status: {
            $in: [SALES_ORDER_STATUSES.CONFIRMED, SALES_ORDER_STATUSES.PARTIALLY_INVOICED],
          },
          items: {
            $elemMatch: {
              productId: line.productId,
              invoicedQty: { $lte: line.quantity - quantity + QUANTITY_EPSILON },
            },
          },
        },
        { $inc: { 'items.$[line].invoicedQty': quantity } },
        { arrayFilters: [{ 'line.productId': line.productId }], ...sessionOption(session) },
      );
      if (claimed.matchedCount === 0) {
        throw AppError.conflict(
          `${line.productName} was just invoiced by someone else. Refresh the order and try again`,
        );
      }
    }

    const invoice = await persistInvoice(ctx, prepared, session, {
      salesOrderId: order._id,
      salesOrderNumber: order.number,
    });
    await refreshOrderStatus(ctx, order._id, session);

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.SALES_ORDER_INVOICED,
        entityType: 'SalesOrder',
        entityId: order._id,
        entityLabel: order.number,
        branchId: order.branchId,
        after: { invoice: invoice.number, totalPaise: invoice.totalPaise },
      },
      session,
    );

    return invoice._id;
  });

  const [invoice, refreshed] = await Promise.all([
    Invoice.findOne({ ...orgFilter(ctx), _id: invoiceId }).lean(),
    SalesOrder.findOne({ ...orgFilter(ctx), _id: order._id }).lean(),
  ]);
  return { invoice: presentInvoice(ctx, invoice!), order: refreshed! };
}

export interface SalesOrderListFilters {
  branchId?: string;
  status?: string;
  customerId?: string;
  q?: string;
}

export async function listSalesOrders(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: SalesOrderListFilters,
) {
  const filter: Record<string, unknown> = { ...orgFilter(ctx) };

  if (filters.branchId) {
    const branchId = new Types.ObjectId(filters.branchId);
    assertBranchAccess(ctx, branchId);
    filter.branchId = branchId;
  } else if (!ctx.allBranches) {
    filter.branchId = { $in: ctx.branchIds };
  }
  if (filters.status) filter.status = filters.status;
  if (filters.customerId) filter.customerId = new Types.ObjectId(filters.customerId);
  if (filters.q) {
    const pattern = safeSearchRegex(filters.q);
    filter.$or = [{ number: pattern }, { customerName: pattern }];
  }

  const [items, total] = await Promise.all([
    SalesOrder.find(filter)
      .sort({ orderDate: -1, _id: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .select('-items')
      .lean(),
    SalesOrder.countDocuments(filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function getSalesOrder(ctx: TenantContext, id: Types.ObjectId) {
  const order = await SalesOrder.findOne({ ...orgFilter(ctx), _id: id }).lean();
  if (!order) throw AppError.notFound('Sales order');
  assertBranchAccess(ctx, order.branchId);

  const invoices = await Invoice.find({ ...orgFilter(ctx), salesOrderId: id })
    .sort({ invoiceDate: -1 })
    .select('number status invoiceDate totalPaise paidPaise')
    .lean();

  return { ...order, invoices };
}

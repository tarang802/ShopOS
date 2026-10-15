import { Types, type ClientSession } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  INVENTORY_TRANSACTION_TYPES,
  INVOICE_STATUSES,
  PERMISSIONS,
  computeLineAmounts,
  daysOverdue,
  endOfDayInTimeZone,
  invoiceOutstandingPaise,
  invoiceRefundDuePaise,
  sumPaise,
  toSkip,
  type PaginationQuery,
} from '@shopos/shared';
import { Branch, Customer, Invoice, Organization, Product, type IInvoice } from '../../db/models';
import { AppError } from '../../core/AppError';
import { safeSearchRegex } from '../../core/listQuery';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { sessionOption, withTransaction } from '../../db/transaction';
import { applyMovement, getStockPolicy } from '../../services/inventoryService';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';
import {
  OPEN_INVOICE_STATUSES,
  customerOutstandingPaise,
} from '../../services/receivablesService';
import { resolvePrices } from '../pricing/pricing.service';

/**
 * Invoices - the event that moves stock and money.
 *
 * This is the module the rest of ShopOS has been building toward. Everything
 * else - the pricing engine, the inventory ledger, the atomic stock decrement -
 * exists so that this one operation can be trusted: the rate charged is the
 * real rate, the stock reduced is real stock, and once the invoice is saved,
 * nothing that happens to the product afterwards can rewrite what it says.
 *
 * A line's price is always resolved by the pricing engine at the moment of
 * sale, never typed in freely. Two things let it differ, and both are guarded by
 * the one permission the business rules single out as where retail fraud
 * actually happens, `sales:discount_override`: typing a different rate, and
 * discounting beyond the business's own threshold.
 *
 * Creating an invoice is split in two so other documents can reuse it. `prepare`
 * does every read and every check and writes nothing; `persist` does the writes
 * inside a transaction the caller owns. A sales order, for instance, invoices
 * part of itself by preparing an invoice and persisting it in the same
 * transaction that records what has now been billed.
 */

export interface InvoiceLineInput {
  productId: string;
  quantity: number;
  priceListId?: string;
  /** Percent off the line. Above the business threshold it needs sales:discount_override. */
  discountPercent?: number;
  /** Only honoured with sales:discount_override. Overrides the resolved rate. */
  overrideUnitPricePaise?: number;
}

export interface CreateInvoiceInput {
  branchId: string;
  customerId?: string;
  customerName?: string;
  /** Overrides the customer's usual credit days for this invoice. */
  creditDays?: number;
  notes?: string;
  items: InvoiceLineInput[];
}

export interface PreparedLine {
  productId: Types.ObjectId;
  productName: string;
  sku: string;
  unitSymbol: string;
  quantity: number;
  unitPricePaise: number;
  grossPaise: number;
  discountPercent: number;
  discountPaise: number;
  taxRatePercent: number;
  subtotalPaise: number;
  taxPaise: number;
  lineTotalPaise: number;
  unitCostPaise: number;
  returnedQty: number;
}

export interface PreparedInvoice {
  branchId: Types.ObjectId;
  branchName: string;
  customerId?: Types.ObjectId;
  customerName: string;
  creditDays: number;
  /** The business's timezone, which decides where a due date's day ends. */
  timeZone: string;
  notes?: string;
  items: PreparedLine[];
  discountPaise: number;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
}

const DAY_MS = 86_400_000;

/**
 * Everything that must be true before an invoice can be written, and the
 * invoice that would result. Performs no writes.
 */
export async function prepareInvoice(
  ctx: TenantContext,
  input: CreateInvoiceInput,
): Promise<PreparedInvoice> {
  const branchId = new Types.ObjectId(input.branchId);
  assertBranchAccess(ctx, branchId);

  const [branch, organization] = await Promise.all([
    Branch.findOne({ ...orgFilter(ctx), _id: branchId }).select('name').lean(),
    Organization.findById(ctx.organizationId).select('settings timezone').lean(),
  ]);
  if (!branch) throw AppError.notFound('Branch');

  let customerName = input.customerName?.trim();
  let customerId: Types.ObjectId | undefined;
  let customerCreditDays = 0;
  let creditLimitPaise: number | undefined;
  if (input.customerId) {
    const customer = await Customer.findOne({ ...orgFilter(ctx), _id: input.customerId }).lean();
    if (!customer) throw AppError.badRequest('Select a valid customer');
    if (!customer.isActive) throw AppError.badRequest(`${customer.name} is marked inactive`);
    customerId = customer._id;
    customerName = customer.name;
    customerCreditDays = customer.creditDays ?? 0;
    creditLimitPaise = customer.creditLimitPaise;
  }
  if (!customerName) customerName = 'Walk-in Customer';

  const allowOverride = ctx.permissions.has(PERMISSIONS.SALES_DISCOUNT_OVERRIDE);
  const maxDiscountPercent = organization?.settings.maxDiscountPercent ?? 10;

  const productIds = [...new Set(input.items.map((item) => item.productId))].map(
    (id) => new Types.ObjectId(id),
  );
  const [resolved, products] = await Promise.all([
    resolvePrices(
      ctx,
      input.items.map((item) => ({
        productId: new Types.ObjectId(item.productId),
        ...(item.priceListId ? { priceListId: new Types.ObjectId(item.priceListId) } : {}),
        quantity: item.quantity,
      })),
    ),
    // The cost is selected explicitly: it is hidden by default so that only code
    // which means to freeze it onto the line ever reads it.
    Product.find({ ...orgFilter(ctx), _id: { $in: productIds } })
      .select('+costPricePaise isActive')
      .lean(),
  ]);
  const productById = new Map(products.map((product) => [product._id.toString(), product]));

  const items: PreparedLine[] = input.items.map((item, index) => {
    const price = resolved[index]!;
    const product = productById.get(item.productId);
    if (!product) throw AppError.notFound('Product');
    if (!product.isActive) {
      throw AppError.badRequest(`${price.productName} is archived and cannot be sold`);
    }

    let unitPricePaise = price.unitPricePaise;
    if (item.overrideUnitPricePaise !== undefined) {
      if (!allowOverride) throw AppError.permissionDenied(PERMISSIONS.SALES_DISCOUNT_OVERRIDE);
      unitPricePaise = item.overrideUnitPricePaise;
    }

    const discountPercent = item.discountPercent ?? 0;
    if (discountPercent > maxDiscountPercent && !allowOverride) {
      throw new AppError(
        403,
        ERROR_CODES.PERMISSION_DENIED,
        `A discount above ${maxDiscountPercent}% needs the "${PERMISSIONS.SALES_DISCOUNT_OVERRIDE}" permission`,
      );
    }

    const amounts = computeLineAmounts({
      unitPricePaise,
      quantity: item.quantity,
      discountPercent,
      taxRatePercent: price.taxRatePercent,
    });

    return {
      productId: product._id,
      productName: price.productName,
      sku: price.sku,
      unitSymbol: price.unitSymbol,
      quantity: item.quantity,
      unitPricePaise,
      discountPercent,
      taxRatePercent: price.taxRatePercent,
      ...amounts,
      unitCostPaise: product.costPricePaise ?? 0,
      returnedQty: 0,
    };
  });

  const subtotalPaise = sumPaise(items.map((line) => line.subtotalPaise));
  const taxPaise = sumPaise(items.map((line) => line.taxPaise));
  const totalPaise = subtotalPaise + taxPaise;

  if (
    customerId &&
    creditLimitPaise &&
    creditLimitPaise > 0 &&
    organization?.settings.enforceCreditLimit
  ) {
    const owed = await customerOutstandingPaise(ctx, customerId);
    if (owed + totalPaise > creditLimitPaise) {
      throw new AppError(
        422,
        ERROR_CODES.CREDIT_LIMIT_EXCEEDED,
        `${customerName} already owes ${owed} paise and this invoice would take them past their credit limit of ${creditLimitPaise} paise`,
      );
    }
  }

  return {
    branchId,
    branchName: branch.name,
    ...(customerId ? { customerId } : {}),
    customerName,
    creditDays: input.creditDays ?? customerCreditDays,
    timeZone: organization?.timezone ?? 'Asia/Kolkata',
    ...(input.notes ? { notes: input.notes } : {}),
    items,
    discountPaise: sumPaise(items.map((line) => line.discountPaise)),
    subtotalPaise,
    taxPaise,
    totalPaise,
  };
}

/**
 * Write a prepared invoice: number it, take the stock, save it, audit it.
 *
 * Runs inside the caller's transaction. Stock is reduced line by line in the
 * same transaction as the invoice write, so if any line runs out of stock,
 * everything already reduced rolls back with it - a half-sold invoice cannot
 * exist.
 */
export async function persistInvoice(
  ctx: TenantContext,
  prepared: PreparedInvoice,
  session: ClientSession | undefined,
  extras: { salesOrderId?: Types.ObjectId; salesOrderNumber?: string } = {},
) {
  const policy = await getStockPolicy(ctx);
  const number = await nextDocumentNumber(ctx.organizationId, 'INV', session);
  const documentId = new Types.ObjectId();

  for (const line of prepared.items) {
    await applyMovement(
      ctx,
      {
        branchId: prepared.branchId,
        productId: line.productId,
        type: INVENTORY_TRANSACTION_TYPES.SALE,
        quantity: line.quantity,
        referenceType: 'INVOICE',
        referenceId: documentId,
        referenceNumber: number,
      },
      policy,
      session,
    );
  }

  const invoiceDate = new Date();
  const [invoice] = await Invoice.create(
    [
      {
        _id: documentId,
        ...orgFilter(ctx),
        branchId: prepared.branchId,
        branchName: prepared.branchName,
        ...(prepared.customerId ? { customerId: prepared.customerId } : {}),
        customerName: prepared.customerName,
        number,
        status: INVOICE_STATUSES.ISSUED,
        invoiceDate,
        creditDays: prepared.creditDays,
        dueDate: endOfDayInTimeZone(
          new Date(invoiceDate.getTime() + prepared.creditDays * DAY_MS),
          prepared.timeZone,
        ),
        items: prepared.items,
        discountPaise: prepared.discountPaise,
        subtotalPaise: prepared.subtotalPaise,
        taxPaise: prepared.taxPaise,
        totalPaise: prepared.totalPaise,
        paidPaise: 0,
        returnedPaise: 0,
        refundedPaise: 0,
        ...(extras.salesOrderId ? { salesOrderId: extras.salesOrderId } : {}),
        ...(extras.salesOrderNumber ? { salesOrderNumber: extras.salesOrderNumber } : {}),
        ...(prepared.notes ? { notes: prepared.notes } : {}),
        createdBy: ctx.userId,
        createdByName: ctx.userName,
      },
    ],
    sessionOption(session),
  );
  if (!invoice) throw AppError.internal('Could not create the invoice');

  await recordAudit(
    ctx,
    {
      action: AUDIT_ACTIONS.INVOICE_CREATED,
      entityType: 'Invoice',
      entityId: documentId,
      entityLabel: number,
      branchId: prepared.branchId,
      after: {
        customerName: prepared.customerName,
        totalPaise: prepared.totalPaise,
        lines: prepared.items.length,
        ...(prepared.discountPaise > 0 ? { discountPaise: prepared.discountPaise } : {}),
      },
    },
    session,
  );

  return invoice;
}

export async function createInvoice(ctx: TenantContext, input: CreateInvoiceInput) {
  const prepared = await prepareInvoice(ctx, input);
  const invoice = await withTransaction((session) => persistInvoice(ctx, prepared, session));
  return presentInvoice(ctx, invoice.toObject());
}

/**
 * An invoice as the API returns it: balances worked out, and the cost removed
 * unless the caller may see it.
 *
 * Outstanding and overdue are derived here, from the same shared arithmetic the
 * web app uses, rather than stored - a stored balance is one more number that
 * could disagree with the payments behind it.
 */
export function presentInvoice(ctx: TenantContext, invoice: IInvoice, now: Date = new Date()) {
  const showCost = ctx.permissions.has(PERMISSIONS.COSTS_VIEW);
  const amounts = {
    totalPaise: invoice.totalPaise,
    paidPaise: invoice.paidPaise,
    returnedPaise: invoice.returnedPaise ?? 0,
    refundedPaise: invoice.refundedPaise ?? 0,
  };
  const cancelled = invoice.status === INVOICE_STATUSES.CANCELLED;
  const open = (OPEN_INVOICE_STATUSES as readonly string[]).includes(invoice.status);

  return {
    ...invoice,
    items: invoice.items?.map(({ unitCostPaise, ...line }) =>
      showCost ? { ...line, unitCostPaise } : line,
    ),
    outstandingPaise: cancelled ? 0 : invoiceOutstandingPaise(amounts),
    refundDuePaise: cancelled ? 0 : invoiceRefundDuePaise(amounts),
    overdueDays: open && invoice.dueDate ? daysOverdue(invoice.dueDate, now) : 0,
  };
}

export interface InvoiceListFilters {
  branchId?: string;
  status?: string;
  customerId?: string;
  /** Matches the invoice number or the customer's name. */
  q?: string;
  from?: Date;
  to?: Date;
  /** Only invoices past their due date with money still owed. */
  overdue?: boolean;
  /** Only invoices with money still owed. */
  outstandingOnly?: boolean;
}

const SORTABLE_FIELDS = ['invoiceDate', 'dueDate', 'totalPaise', 'number', 'customerName'];

export async function listInvoices(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: InvoiceListFilters,
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

  if (filters.overdue || filters.outstandingOnly) {
    filter.status = { $in: [...OPEN_INVOICE_STATUSES] };
  } else if (filters.status) {
    filter.status = filters.status;
  }
  if (filters.overdue) filter.dueDate = { $lt: new Date() };

  if (filters.q) {
    const pattern = safeSearchRegex(filters.q);
    filter.$or = [{ number: pattern }, { customerName: pattern }];
  }

  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = filters.from;
    if (filters.to) {
      // The end date is a calendar day, so it includes that whole day.
      const end = new Date(filters.to);
      end.setUTCHours(23, 59, 59, 999);
      range.$lte = end;
    }
    filter.invoiceDate = range;
  }

  const sortField =
    query.sortBy && SORTABLE_FIELDS.includes(query.sortBy) ? query.sortBy : 'invoiceDate';
  const sortDirection = query.sortBy && query.sortOrder === 'asc' ? 1 : -1;

  const [rows, total] = await Promise.all([
    Invoice.find(filter)
      .sort({ [sortField]: sortDirection, _id: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .select('-items')
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  const now = new Date();
  return {
    items: rows.map((row) => presentInvoice(ctx, row as IInvoice, now)),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getInvoice(ctx: TenantContext, invoiceId: Types.ObjectId) {
  const invoice = await Invoice.findOne({ ...orgFilter(ctx), _id: invoiceId }).lean();
  if (!invoice) throw AppError.notFound('Invoice');
  assertBranchAccess(ctx, invoice.branchId);
  return presentInvoice(ctx, invoice);
}

/**
 * Cancel an invoice and return the stock it moved.
 *
 * Never deleted - per the business rules, an invoice is a historical fact.
 * Cancelling reverses its stock effect and marks it, leaving the original
 * document and its frozen values fully intact and readable.
 *
 * Only goods still with the customer go back on the shelf: anything they already
 * returned was restocked by the return itself.
 */
export async function cancelInvoice(
  ctx: TenantContext,
  invoiceId: Types.ObjectId,
  reason?: string,
) {
  const invoice = await Invoice.findOne({ ...orgFilter(ctx), _id: invoiceId });
  if (!invoice) throw AppError.notFound('Invoice');
  assertBranchAccess(ctx, invoice.branchId);

  if (invoice.status === INVOICE_STATUSES.CANCELLED) {
    throw AppError.businessRule('This invoice is already cancelled');
  }
  if (invoice.paidPaise > 0) {
    throw new AppError(
      422,
      ERROR_CODES.BUSINESS_RULE_VIOLATION,
      'This invoice has payments recorded against it and cannot be cancelled directly. Void the payments first.',
    );
  }

  return withTransaction(async (session) => {
    // Claimed with a conditional update: a payment recorded a moment ago changes
    // paidPaise and status, and cancelling an invoice that has just been paid
    // would strand that money against a cancelled bill.
    const claimed = await Invoice.updateOne(
      {
        ...orgFilter(ctx),
        _id: invoice._id,
        status: invoice.status,
        paidPaise: 0,
      },
      {
        $set: {
          status: INVOICE_STATUSES.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: ctx.userId,
          ...(reason ? { cancelReason: reason } : {}),
        },
      },
      sessionOption(session),
    );
    if (claimed.matchedCount === 0) {
      throw AppError.conflict('This invoice was just changed by someone else. Refresh and try again');
    }

    for (const line of invoice.items) {
      const stillWithCustomer = line.quantity - (line.returnedQty ?? 0);
      if (stillWithCustomer <= 0) continue;

      await applyMovement(
        ctx,
        {
          branchId: invoice.branchId,
          productId: line.productId,
          type: INVENTORY_TRANSACTION_TYPES.SALE_RETURN,
          quantity: stillWithCustomer,
          referenceType: 'INVOICE',
          referenceId: invoice._id,
          referenceNumber: invoice.number,
          notes: 'Invoice cancelled, stock returned',
        },
        { allowNegative: true },
        session,
      );
    }

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.INVOICE_CANCELLED,
        entityType: 'Invoice',
        entityId: invoice._id,
        entityLabel: invoice.number,
        branchId: invoice.branchId,
        after: { reason },
      },
      session,
    );

    const updated = await Invoice.findOne({ ...orgFilter(ctx), _id: invoice._id })
      .session(session ?? null)
      .lean();
    return presentInvoice(ctx, updated!);
  });
}

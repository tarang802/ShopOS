import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  INVENTORY_TRANSACTION_TYPES,
  INVOICE_STATUSES,
  PERMISSIONS,
  multiplyPaise,
  percentOfPaise,
  sumPaise,
  toSkip,
  type PaginationQuery,
} from '@shopos/shared';
import { Branch, Customer, Invoice, Product } from '../../db/models';
import { AppError } from '../../core/AppError';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { withTransaction } from '../../db/transaction';
import { applyMovement, getStockPolicy } from '../../services/inventoryService';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';
import { resolvePrice } from '../pricing/pricing.service';

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
 * sale, never typed in freely, unless the caller holds `sales:discount_override`
 * - the one permission the business rules single out as where retail fraud
 * actually happens.
 */

export interface InvoiceLineInput {
  productId: string;
  quantity: number;
  priceListId?: string;
  /** Only honoured with sales:discount_override. Overrides the resolved rate. */
  overrideUnitPricePaise?: number;
}

export interface CreateInvoiceInput {
  branchId: string;
  customerId?: string;
  customerName?: string;
  notes?: string;
  items: InvoiceLineInput[];
}

async function buildLine(
  ctx: TenantContext,
  input: InvoiceLineInput,
  allowOverride: boolean,
) {
  const productId = new Types.ObjectId(input.productId);

  const resolved = await resolvePrice(ctx, {
    productId,
    ...(input.priceListId ? { priceListId: new Types.ObjectId(input.priceListId) } : {}),
    quantity: input.quantity,
  });

  let unitPricePaise = resolved.unitPricePaise;

  if (input.overrideUnitPricePaise !== undefined) {
    if (!allowOverride) {
      throw AppError.permissionDenied(PERMISSIONS.SALES_DISCOUNT_OVERRIDE);
    }
    unitPricePaise = input.overrideUnitPricePaise;
  }

  const product = await Product.findOne({ ...orgFilter(ctx), _id: productId })
    .select('taxRatePercent')
    .lean();
  if (!product) throw AppError.notFound('Product');

  const subtotalPaise = multiplyPaise(unitPricePaise, input.quantity);
  const taxPaise = percentOfPaise(subtotalPaise, product.taxRatePercent);

  return {
    productId,
    productName: resolved.productName,
    sku: resolved.sku,
    unitSymbol: resolved.unitSymbol,
    quantity: input.quantity,
    unitPricePaise,
    taxRatePercent: product.taxRatePercent,
    subtotalPaise,
    taxPaise,
    lineTotalPaise: subtotalPaise + taxPaise,
  };
}

export async function createInvoice(ctx: TenantContext, input: CreateInvoiceInput) {
  const branchId = new Types.ObjectId(input.branchId);
  assertBranchAccess(ctx, branchId);

  const branch = await Branch.findOne({ ...orgFilter(ctx), _id: branchId }).lean();
  if (!branch) throw AppError.notFound('Branch');

  let customerName = input.customerName?.trim();
  let customerId: Types.ObjectId | undefined;
  if (input.customerId) {
    const customer = await Customer.findOne({ ...orgFilter(ctx), _id: input.customerId }).lean();
    if (!customer) throw AppError.badRequest('Select a valid customer');
    customerId = customer._id;
    customerName = customer.name;
  }
  if (!customerName) customerName = 'Walk-in Customer';

  const allowOverride = ctx.permissions.has(PERMISSIONS.SALES_DISCOUNT_OVERRIDE);
  const policy = await getStockPolicy(ctx);

  return withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.organizationId, 'INV', session);
    const documentId = new Types.ObjectId();

    const items = [];
    for (const lineInput of input.items) {
      const line = await buildLine(ctx, lineInput, allowOverride);
      items.push(line);

      // Stock is reduced line by line, inside the same transaction as the
      // invoice write. If any line runs out of stock, everything already
      // reduced in this loop rolls back with it - a half-sold invoice cannot
      // exist.
      await applyMovement(
        ctx,
        {
          branchId,
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

    const subtotalPaise = sumPaise(items.map((i) => i.subtotalPaise));
    const taxPaise = sumPaise(items.map((i) => i.taxPaise));
    const totalPaise = subtotalPaise + taxPaise;

    const [invoice] = await Invoice.create(
      [
        {
          _id: documentId,
          ...orgFilter(ctx),
          branchId,
          branchName: branch.name,
          ...(customerId ? { customerId } : {}),
          customerName,
          number,
          status: INVOICE_STATUSES.ISSUED,
          items,
          subtotalPaise,
          taxPaise,
          totalPaise,
          paidPaise: 0,
          notes: input.notes,
          createdBy: ctx.userId,
          createdByName: ctx.userName,
        },
      ],
      session ? { session } : {},
    );
    if (!invoice) throw AppError.internal('Could not create the invoice');

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.INVOICE_CREATED,
        entityType: 'Invoice',
        entityId: documentId,
        entityLabel: number,
        branchId,
        after: { customerName, totalPaise, lines: items.length },
      },
      session,
    );

    return invoice.toObject();
  });
}

export async function listInvoices(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: { branchId?: string; status?: string; customerId?: string },
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

  const [items, total] = await Promise.all([
    Invoice.find(filter)
      .sort({ invoiceDate: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .select('-items')
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function getInvoice(ctx: TenantContext, invoiceId: Types.ObjectId) {
  const invoice = await Invoice.findOne({ ...orgFilter(ctx), _id: invoiceId }).lean();
  if (!invoice) throw AppError.notFound('Invoice');
  assertBranchAccess(ctx, invoice.branchId);
  return { ...invoice, outstandingPaise: invoice.totalPaise - invoice.paidPaise };
}

/**
 * Cancel an invoice and return the stock it moved.
 *
 * Never deleted - per the business rules, an invoice is a historical fact.
 * Cancelling reverses its stock effect and marks it, leaving the original
 * document and its frozen values fully intact and readable.
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
      'This invoice has payments recorded against it and cannot be cancelled directly. Reverse the payments first.',
    );
  }

  return withTransaction(async (session) => {
    for (const line of invoice.items) {
      await applyMovement(
        ctx,
        {
          branchId: invoice.branchId,
          productId: line.productId,
          type: INVENTORY_TRANSACTION_TYPES.SALE_RETURN,
          quantity: line.quantity,
          referenceType: 'INVOICE',
          referenceId: invoice._id,
          referenceNumber: invoice.number,
          notes: 'Invoice cancelled, stock returned',
        },
        { allowNegative: true },
        session,
      );
    }

    invoice.status = INVOICE_STATUSES.CANCELLED;
    invoice.cancelledAt = new Date();
    invoice.cancelledBy = ctx.userId;
    if (reason) invoice.cancelReason = reason;
    await invoice.save(session ? { session } : {});

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

    return invoice.toObject();
  });
}

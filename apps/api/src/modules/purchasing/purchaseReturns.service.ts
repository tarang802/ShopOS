import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  INVENTORY_TRANSACTION_TYPES,
  multiplyPaise,
  sumPaise,
  toSkip,
  type PaginationQuery,
  type ReturnReason,
} from '@shopos/shared';
import { PurchaseOrder, PurchaseReturn, type IPurchaseReturnItem } from '../../db/models';
import { AppError } from '../../core/AppError';
import { safeSearchRegex } from '../../core/listQuery';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { sessionOption, withTransaction } from '../../db/transaction';
import { applyMovement, getStockPolicy } from '../../services/inventoryService';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';
import { amountMatches } from '../../services/receivablesService';

/**
 * Purchase returns: goods back to the supplier.
 *
 * The stock leaves the branch that received it, so a return is refused when the
 * goods are no longer there to send back (they may already have been sold) unless
 * the business allows negative stock. The value comes off what is owed to the
 * supplier, at the order's own unit prices.
 */

/** Quantities carry up to three decimals, so comparisons allow for float noise. */
const QUANTITY_EPSILON = 1e-9;

export interface PurchaseReturnInput {
  purchaseOrderId: string;
  reason: ReturnReason;
  notes?: string;
  items: { productId: string; quantity: number }[];
}

export async function createPurchaseReturn(ctx: TenantContext, input: PurchaseReturnInput) {
  const purchaseOrderId = new Types.ObjectId(input.purchaseOrderId);
  const policy = await getStockPolicy(ctx);

  return withTransaction(async (session) => {
    const po = await PurchaseOrder.findOne({ ...orgFilter(ctx), _id: purchaseOrderId }).session(
      session ?? null,
    );
    if (!po) throw AppError.notFound('Purchase order');
    assertBranchAccess(ctx, po.branchId);

    const lineByProduct = new Map(po.items.map((line) => [line.productId.toString(), line]));

    const returnItems: (IPurchaseReturnItem & { newReturnedQty: number })[] = [];
    for (const item of input.items) {
      const line = lineByProduct.get(item.productId);
      if (!line) throw AppError.badRequest('One or more products are not on this purchase order');

      const alreadyReturned = line.returnedQty ?? 0;
      const returnable = line.receivedQty - alreadyReturned;
      if (item.quantity > returnable + QUANTITY_EPSILON) {
        throw AppError.businessRule(
          `Only ${returnable} ${line.unitSymbol} of ${line.productName} can be returned - that is what this order delivered and has not already sent back`,
        );
      }

      returnItems.push({
        productId: line.productId,
        productName: line.productName,
        sku: line.sku,
        unitSymbol: line.unitSymbol,
        quantity: item.quantity,
        unitPricePaise: line.unitPricePaise,
        valuePaise: multiplyPaise(line.unitPricePaise, item.quantity),
        newReturnedQty: alreadyReturned + item.quantity,
      });
    }

    const totalPaise = sumPaise(returnItems.map((item) => item.valuePaise));

    const inc: Record<string, number> = { returnedPaise: totalPaise };
    const arrayFilters: Record<string, unknown>[] = [];
    returnItems.forEach((item, index) => {
      inc[`items.$[line${index}].returnedQty`] = item.quantity;
      arrayFilters.push({ [`line${index}.productId`]: item.productId });
    });

    // Matches only if nothing on the order's money moved since it was read, so two
    // returns racing on the same delivery cannot both send back the same goods.
    const swapped = await PurchaseOrder.updateOne(
      {
        ...orgFilter(ctx),
        _id: po._id,
        status: po.status,
        paidPaise: amountMatches(po.paidPaise),
        returnedPaise: amountMatches(po.returnedPaise),
      },
      { $inc: inc },
      { arrayFilters, ...sessionOption(session) },
    );
    if (swapped.matchedCount === 0) {
      throw AppError.conflict(
        `Purchase order ${po.number} was just changed by someone else. Refresh and try again`,
      );
    }

    const number = await nextDocumentNumber(ctx.organizationId, 'PR', session);
    const returnId = new Types.ObjectId();

    for (const item of returnItems) {
      await applyMovement(
        ctx,
        {
          branchId: po.branchId,
          productId: item.productId,
          type: INVENTORY_TRANSACTION_TYPES.PURCHASE_RETURN,
          quantity: item.quantity,
          referenceType: 'PURCHASE_RETURN',
          referenceId: returnId,
          referenceNumber: number,
          reason: input.reason,
        },
        policy,
        session,
      );
    }

    const [purchaseReturn] = await PurchaseReturn.create(
      [
        {
          _id: returnId,
          ...orgFilter(ctx),
          branchId: po.branchId,
          number,
          purchaseOrderId: po._id,
          purchaseOrderNumber: po.number,
          supplierId: po.supplierId,
          supplierName: po.supplierName,
          reason: input.reason,
          ...(input.notes ? { notes: input.notes } : {}),
          items: returnItems.map(({ newReturnedQty: _unused, ...item }) => item),
          totalPaise,
          createdBy: ctx.userId,
          createdByName: ctx.userName,
        },
      ],
      sessionOption(session),
    );
    if (!purchaseReturn) throw AppError.internal('Could not record the return');

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.PURCHASE_RETURN_CREATED,
        entityType: 'PurchaseReturn',
        entityId: returnId,
        entityLabel: number,
        branchId: po.branchId,
        after: {
          purchaseOrder: po.number,
          supplier: po.supplierName,
          totalPaise,
          reason: input.reason,
          lines: returnItems.length,
        },
      },
      session,
    );

    return purchaseReturn.toObject();
  });
}

export interface PurchaseReturnFilters {
  branchId?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  q?: string;
}

export async function listPurchaseReturns(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: PurchaseReturnFilters,
) {
  const filter: Record<string, unknown> = { ...orgFilter(ctx) };

  if (filters.branchId) {
    const branchId = new Types.ObjectId(filters.branchId);
    assertBranchAccess(ctx, branchId);
    filter.branchId = branchId;
  } else if (!ctx.allBranches) {
    filter.branchId = { $in: ctx.branchIds };
  }
  if (filters.supplierId) filter.supplierId = new Types.ObjectId(filters.supplierId);
  if (filters.purchaseOrderId) filter.purchaseOrderId = new Types.ObjectId(filters.purchaseOrderId);
  if (filters.q) {
    const pattern = safeSearchRegex(filters.q);
    filter.$or = [{ number: pattern }, { purchaseOrderNumber: pattern }, { supplierName: pattern }];
  }

  const [items, total] = await Promise.all([
    PurchaseReturn.find(filter)
      .sort({ returnDate: -1, _id: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .select('-items')
      .lean(),
    PurchaseReturn.countDocuments(filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function getPurchaseReturn(ctx: TenantContext, returnId: Types.ObjectId) {
  const found = await PurchaseReturn.findOne({ ...orgFilter(ctx), _id: returnId }).lean();
  if (!found) throw AppError.notFound('Return');
  assertBranchAccess(ctx, found.branchId);
  return found;
}

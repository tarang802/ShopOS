import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  INVENTORY_TRANSACTION_TYPES,
  PURCHASE_ORDER_STATUSES,
  multiplyPaise,
  sumPaise,
  toSkip,
  type PaginationQuery,
} from '@shopos/shared';
import { Branch, GoodsReceipt, Product, PurchaseOrder, Supplier } from '../../db/models';
import { AppError } from '../../core/AppError';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { withTransaction } from '../../db/transaction';
import { applyMovement } from '../../services/inventoryService';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';

/**
 * Purchasing: order, then receive. Ordering never touches stock.
 *
 * The rule stated throughout the product brief is enforced structurally here:
 * `createPurchaseOrder` never calls `applyMovement`. Only `receiveGoods` does,
 * and only for the quantity actually confirmed as received - which is why a
 * purchase order can be received in several partial deliveries without the
 * inventory ledger ever recording more than physically arrived.
 */

export interface PurchaseOrderLineInput {
  productId: string;
  orderedQty: number;
  unitPricePaise: number;
}

export interface CreatePurchaseOrderInput {
  branchId: string;
  supplierId: string;
  notes?: string;
  items: PurchaseOrderLineInput[];
}

export async function createPurchaseOrder(ctx: TenantContext, input: CreatePurchaseOrderInput) {
  const branchId = new Types.ObjectId(input.branchId);
  assertBranchAccess(ctx, branchId);

  const [branch, supplier] = await Promise.all([
    Branch.findOne({ ...orgFilter(ctx), _id: branchId }).lean(),
    Supplier.findOne({ ...orgFilter(ctx), _id: input.supplierId }).lean(),
  ]);
  if (!branch) throw AppError.notFound('Branch');
  if (!supplier) throw AppError.badRequest('Select a valid supplier');

  const productIds = input.items.map((item) => new Types.ObjectId(item.productId));
  const products = await Product.find({ ...orgFilter(ctx), _id: { $in: productIds } }).lean();
  const productById = new Map(products.map((product) => [product._id.toString(), product]));
  if (products.length !== new Set(input.items.map((item) => item.productId)).size) {
    throw AppError.badRequest('One or more products are not valid');
  }

  const items = input.items.map((item) => {
    const product = productById.get(item.productId)!;
    return {
      productId: product._id,
      productName: product.name,
      sku: product.sku,
      unitSymbol: product.unitSymbol,
      orderedQty: item.orderedQty,
      receivedQty: 0,
      unitPricePaise: item.unitPricePaise,
      lineTotalPaise: multiplyPaise(item.unitPricePaise, item.orderedQty),
    };
  });

  return withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.organizationId, 'PO', session);

    const [po] = await PurchaseOrder.create(
      [
        {
          ...orgFilter(ctx),
          branchId,
          branchName: branch.name,
          supplierId: supplier._id,
          supplierName: supplier.name,
          number,
          status: PURCHASE_ORDER_STATUSES.DRAFT,
          items,
          totalPaise: sumPaise(items.map((i) => i.lineTotalPaise)),
          notes: input.notes,
          createdBy: ctx.userId,
          createdByName: ctx.userName,
        },
      ],
      session ? { session } : {},
    );
    if (!po) throw AppError.internal('Could not create the purchase order');

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.PURCHASE_ORDER_CREATED,
        entityType: 'PurchaseOrder',
        entityId: po._id,
        entityLabel: number,
        branchId,
        after: { supplier: supplier.name, totalPaise: po.totalPaise, lines: items.length },
      },
      session,
    );

    return po.toObject();
  });
}

/** DRAFT -> SENT. A purchase order cannot be received until it has been sent. */
export async function sendPurchaseOrder(ctx: TenantContext, purchaseOrderId: Types.ObjectId) {
  const po = await PurchaseOrder.findOne({ ...orgFilter(ctx), _id: purchaseOrderId });
  if (!po) throw AppError.notFound('Purchase order');
  if (po.status !== PURCHASE_ORDER_STATUSES.DRAFT) {
    throw AppError.businessRule('Only a draft purchase order can be sent');
  }

  po.status = PURCHASE_ORDER_STATUSES.SENT;
  await po.save();

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.PURCHASE_ORDER_SENT,
    entityType: 'PurchaseOrder',
    entityId: po._id,
    entityLabel: po.number,
    branchId: po.branchId,
  });

  return po.toObject();
}

export async function cancelPurchaseOrder(ctx: TenantContext, purchaseOrderId: Types.ObjectId) {
  const po = await PurchaseOrder.findOne({ ...orgFilter(ctx), _id: purchaseOrderId });
  if (!po) throw AppError.notFound('Purchase order');
  if (po.items.some((item) => item.receivedQty > 0)) {
    throw AppError.businessRule('A purchase order that has already received goods cannot be cancelled');
  }
  if (po.status === PURCHASE_ORDER_STATUSES.CANCELLED) {
    throw AppError.businessRule('This purchase order is already cancelled');
  }

  po.status = PURCHASE_ORDER_STATUSES.CANCELLED;
  await po.save();

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.PURCHASE_ORDER_CANCELLED,
    entityType: 'PurchaseOrder',
    entityId: po._id,
    entityLabel: po.number,
    branchId: po.branchId,
  });

  return po.toObject();
}

export interface ReceiveGoodsInput {
  items: { productId: string; receivedQty: number }[];
  notes?: string;
}

/**
 * Record a delivery against a purchase order - full or partial - and increase
 * stock by exactly what arrived.
 */
export async function receiveGoods(
  ctx: TenantContext,
  purchaseOrderId: Types.ObjectId,
  input: ReceiveGoodsInput,
) {
  const po = await PurchaseOrder.findOne({ ...orgFilter(ctx), _id: purchaseOrderId });
  if (!po) throw AppError.notFound('Purchase order');
  assertBranchAccess(ctx, po.branchId);

  if (
    po.status !== PURCHASE_ORDER_STATUSES.SENT &&
    po.status !== PURCHASE_ORDER_STATUSES.PARTIALLY_RECEIVED
  ) {
    throw AppError.businessRule(`This purchase order is ${po.status.toLowerCase()} and cannot receive goods`);
  }

  const lineByProduct = new Map(po.items.map((item) => [item.productId.toString(), item]));
  const receiptLines: { line: (typeof po.items)[number]; receivedQty: number }[] = [];

  for (const item of input.items) {
    if (item.receivedQty <= 0) continue;
    const line = lineByProduct.get(item.productId);
    if (!line) throw AppError.badRequest('One or more products are not on this purchase order');

    const outstanding = line.orderedQty - line.receivedQty;
    if (item.receivedQty > outstanding) {
      throw AppError.businessRule(
        `Cannot receive ${item.receivedQty} ${line.unitSymbol} of ${line.productName} - only ${outstanding} still outstanding`,
      );
    }
    receiptLines.push({ line, receivedQty: item.receivedQty });
  }

  if (receiptLines.length === 0) {
    throw AppError.badRequest('Enter at least one quantity to receive');
  }

  return withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.organizationId, 'GR', session);
    const receiptId = new Types.ObjectId();

    for (const { line, receivedQty } of receiptLines) {
      await applyMovement(
        ctx,
        {
          branchId: po.branchId,
          productId: line.productId,
          type: INVENTORY_TRANSACTION_TYPES.PURCHASE,
          quantity: receivedQty,
          referenceType: 'GOODS_RECEIPT',
          referenceId: receiptId,
          referenceNumber: number,
        },
        { allowNegative: false }, // irrelevant for an inbound movement, kept for consistency with other call sites
        session,
      );
      line.receivedQty += receivedQty;
    }

    const fullyReceived = po.items.every((item) => item.receivedQty >= item.orderedQty);
    po.status = fullyReceived
      ? PURCHASE_ORDER_STATUSES.RECEIVED
      : PURCHASE_ORDER_STATUSES.PARTIALLY_RECEIVED;
    await po.save(session ? { session } : {});

    const [receipt] = await GoodsReceipt.create(
      [
        {
          _id: receiptId,
          ...orgFilter(ctx),
          purchaseOrderId: po._id,
          purchaseOrderNumber: po.number,
          branchId: po.branchId,
          number,
          items: receiptLines.map(({ line, receivedQty }) => ({
            productId: line.productId,
            productName: line.productName,
            sku: line.sku,
            unitSymbol: line.unitSymbol,
            receivedQty,
          })),
          notes: input.notes,
          receivedBy: ctx.userId,
          receivedByName: ctx.userName,
        },
      ],
      session ? { session } : {},
    );

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.GOODS_RECEIVED,
        entityType: 'GoodsReceipt',
        entityId: receiptId,
        entityLabel: number,
        branchId: po.branchId,
        after: {
          purchaseOrder: po.number,
          status: po.status,
          lines: receiptLines.map(({ line, receivedQty }) => ({
            product: line.productName,
            received: receivedQty,
          })),
        },
      },
      session,
    );

    return { purchaseOrder: po.toObject(), goodsReceipt: receipt?.toObject() };
  });
}

export async function listPurchaseOrders(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: { branchId?: string; status?: string; supplierId?: string },
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
  if (filters.supplierId) filter.supplierId = new Types.ObjectId(filters.supplierId);

  const [items, total] = await Promise.all([
    PurchaseOrder.find(filter).sort({ orderDate: -1 }).skip(toSkip(query.page, query.limit)).limit(query.limit).lean(),
    PurchaseOrder.countDocuments(filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function getPurchaseOrder(ctx: TenantContext, purchaseOrderId: Types.ObjectId) {
  const po = await PurchaseOrder.findOne({ ...orgFilter(ctx), _id: purchaseOrderId }).lean();
  if (!po) throw AppError.notFound('Purchase order');
  assertBranchAccess(ctx, po.branchId);

  const receipts = await GoodsReceipt.find({ ...orgFilter(ctx), purchaseOrderId }).sort({ receivedDate: -1 }).lean();
  return { ...po, receipts };
}
